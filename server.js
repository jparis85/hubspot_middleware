require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const {
  getDealById,
  getCompanyById,
  getContactById,
  searchClosedWonDealsSince,
} = require('./hubspotService');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

let lastPollTime = new Date(Date.now() - 15 * 60 * 1000).toISOString();
let isPolling = false;

// ==========================
// 🔹 CLICKUP CONFIG
// ==========================
const CLICKUP_BASE = 'https://api.clickup.com/api/v2';

const clickupHeaders = {
  Authorization: process.env.CLICKUP_TOKEN,
  'Content-Type': 'application/json',
};

async function syncDealToClickUp(dealId) {
  const deal = await getDealById(dealId);

  const companyId = deal.associations?.companies?.results?.[0]?.id || null;
  const contactId = deal.associations?.contacts?.results?.[0]?.id || null;

  let company = null;
  let contact = null;

  if (companyId) {
    company = await getCompanyById(companyId);
  }

  if (contactId) {
    contact = await getContactById(contactId);
  }

  const canonical = {
    hubspot_deal_id: deal.id || '',
    hubspot_company_id: company?.id || '',
    deal_name: deal.properties?.dealname || '',
    deal_value: deal.properties?.amount || '',
    close_date: deal.properties?.closedate || '',
    renewal_date: deal.properties?.end_of_campaign_date || '',
    legal_entity_name: contact?.properties?.legal_business_name || '',
    dba_store_name: contact?.properties?.dba || company?.properties?.name || '',
    primary_email: contact?.properties?.email || '',
    primary_phone: contact?.properties?.phone || company?.properties?.phone || '',
    company_name: company?.properties?.name || '',
    website: company?.properties?.website || '',
    industry: company?.properties?.industry || '',
    address: company?.properties?.address || '',
    city: company?.properties?.city || '',
    state: company?.properties?.state || '',
    zip: company?.properties?.zip || '',
    location_count: contact?.properties?.owned_locations || '',
  };

  const clickupResult = await upsertClickUpClientTask(canonical);

  return {
    dealId,
    canonical,
    clickupMode: clickupResult.mode,
    clickupTaskId: clickupResult.task.id,
  };
}

async function findExistingTaskByName(taskName) {
  const res = await axios.get(
    `${CLICKUP_BASE}/list/${process.env.CLICKUP_LIST_ID}/task`,
    { headers: clickupHeaders }
  );

  const tasks = res.data.tasks || [];

  return (
    tasks.find(
      (task) => task.name.trim().toLowerCase() === taskName.trim().toLowerCase()
    ) || null
  );
}

async function buildClickUpPayload(canonical) {
  return {
    name:
      canonical.company_name ||
      canonical.dba_store_name ||
      canonical.deal_name ||
      'New Client',

    description: [
      `Created by HubSpot sync`,
      `Market: ${canonical.city && canonical.state ? `${canonical.city}, ${canonical.state}` : ''}`,
      `Number of locations: ${canonical.location_count || ''}`,
      `Store name: ${canonical.dba_store_name || ''}`,
      `Hubspot Company ID: ${canonical.hubspot_company_id || ''}`,
      `Hubspot Deal ID: ${canonical.hubspot_deal_id || ''}`,
    ].join('\n'),

    custom_fields: [
      {
        id: '9c30c95b-e8b9-4a8d-86b5-57444a7dc061',
        value: canonical.hubspot_deal_id,
      },
      {
        id: 'e2ffb995-05b5-403b-9fb5-64773323242d',
        value: canonical.hubspot_company_id,
      },
      {
        id: '107dcb28-f0df-4b53-a6f3-d11950d5c503',
        value: canonical.legal_entity_name || '',
      },
      {
        id: 'fa57bbd3-235a-4334-9ff9-b8025458fb4e',
        value: canonical.dba_store_name || '',
      },
      {
        id: '98fc7f0b-f93e-438b-99a6-b4a047ff236f',
        value: canonical.location_count
          ? Number(canonical.location_count)
          : null,
      },
      {
        id: '05c402cd-5ba4-4db2-8b78-4ed70959a9de',
        value:
          canonical.city && canonical.state
            ? `${canonical.city}, ${canonical.state}`
            : '',
      },
    ],
  };
}

async function createClickUpClientTask(canonical) {
  const payload = await buildClickUpPayload(canonical);

  const res = await axios.post(
    `${CLICKUP_BASE}/list/${process.env.CLICKUP_LIST_ID}/task`,
    payload,
    { headers: clickupHeaders }
  );

  return {
    mode: 'created',
    task: res.data,
  };
}

async function updateClickUpClientTask(taskId, canonical) {
  const payload = await buildClickUpPayload(canonical);

  const res = await axios.put(
    `${CLICKUP_BASE}/task/${taskId}`,
    {
      name: payload.name,
      description: payload.description,
    },
    { headers: clickupHeaders }
  );

  for (const field of payload.custom_fields) {
    await axios.post(
      `${CLICKUP_BASE}/task/${taskId}/field/${field.id}`,
      { value: field.value },
      { headers: clickupHeaders }
    );
  }

  return {
    mode: 'updated',
    task: res.data,
  };
}

async function upsertClickUpClientTask(canonical) {
  const taskName =
    canonical.company_name ||
    canonical.dba_store_name ||
    canonical.deal_name ||
    'New Client';

  const existingTask = await findExistingTaskByName(taskName);

  if (existingTask) {
    return await updateClickUpClientTask(existingTask.id, canonical);
  }

  return await createClickUpClientTask(canonical);
}

app.get('/', (req, res) => {
  res.send('Server is running');
});

app.post('/hubspot/webhook', async (req, res) => {
  try {
    const { dealId } = req.body;

    if (!dealId) {
      return res.status(400).json({ error: 'Missing dealId' });
    }

    const result = await syncDealToClickUp(dealId);

    return res.status(200).json({
      success: true,
      mode: result.clickupMode,
      clickupTaskId: result.clickupTaskId,
      canonical: result.canonical,
    });
  } catch (err) {
    console.error('Webhook error:', err.response?.data || err.message);

    return res.status(500).json({
      error: err.response?.data || err.message,
    });
  }
});

async function pollClosedWonDeals() {
  if (isPolling) {
    console.log('Polling skipped: previous run still in progress');
    return;
  }

  isPolling = true;

  try {
    console.log(`Polling HubSpot for Closed Won deals since ${lastPollTime}`);

    const deals = await searchClosedWonDealsSince(lastPollTime);
    console.log(`Found ${deals.length} matching deal(s)`);

    for (const deal of deals) {
      try {
        const result = await syncDealToClickUp(deal.id);
        console.log(
          `Synced deal ${deal.id} -> ClickUp task ${result.clickupTaskId} (${result.clickupMode})`
        );
      } catch (dealErr) {
        console.error(
          `Failed syncing deal ${deal.id}:`,
          dealErr.response?.data || dealErr.message
        );
      }
    }

    lastPollTime = new Date().toISOString();
  } catch (err) {
    console.error('Polling error:', err.response?.data || err.message);
  } finally {
    isPolling = false;
  }
}

if (process.env.POLL_ENABLED === 'true') {
  cron.schedule('*/5 * * * *', async () => {
    await pollClosedWonDeals();
  });

  console.log('HubSpot polling enabled: every 5 minutes');
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});