require('dotenv').config();
const axios = require('axios');

const CLICKUP_BASE = 'https://api.clickup.com/api/v2';

const clickupHeaders = {
  Authorization: process.env.CLICKUP_TOKEN,
  'Content-Type': 'application/json',
};

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

module.exports = {
  upsertClickUpClientTask,
  findExistingTaskByName,
  buildClickUpPayload,
  createClickUpClientTask,
  updateClickUpClientTask,
};