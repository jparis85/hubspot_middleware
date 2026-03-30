require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const {
  getDealById,
  getCompanyById,
  getContactById,
  searchClosedWonDealsSince,
} = require('./hubspotService');
const { upsertClickUpClientTask } = require('./clickupService');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

let lastPollTime = new Date(Date.now() - 15 * 60 * 1000).toISOString();
let isPolling = false;

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