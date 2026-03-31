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
      `HubSpot Deal ID: ${canonical.hubspot_deal_id || ''}`,
      `HubSpot Company ID: ${canonical.hubspot_company_id || ''}`,
      `Store name: ${canonical.dba_store_name || ''}`,
      `Market: ${canonical.city && canonical.state ? `${canonical.city}, ${canonical.state}` : ''}`,
      `Number of locations: ${canonical.location_count || ''}`,
    ].join('\n'),

    custom_fields: [
      {
        id: '9c30c95b-e8b9-4a8d-86b5-57444a7dc061',
        value: canonical.hubspot_deal_id,
      }
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