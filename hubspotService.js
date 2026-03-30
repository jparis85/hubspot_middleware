const axios = require('axios');

const HUBSPOT_BASE = 'https://api.hubapi.com';

const hubspotHeaders = {
  Authorization: `Bearer ${process.env.HUBSPOT_PRIVATE_APP_TOKEN}`,
  'Content-Type': 'application/json',
};

async function getDealById(dealId) {
  const res = await axios.get(
    `${HUBSPOT_BASE}/crm/v3/objects/deals/${dealId}?properties=dealname,amount,closedate,hs_is_closed_won,pipeline,hubspot_owner_id,end_of_campaign_date,hs_lastmodifieddate&associations=companies,contacts`,
    { headers: hubspotHeaders }
  );
  return res.data;
}

async function getCompanyById(companyId) {
  const res = await axios.get(
    `${HUBSPOT_BASE}/crm/v3/objects/companies/${companyId}?properties=name,domain,website,industry,address,city,state,zip,phone`,
    { headers: hubspotHeaders }
  );
  return res.data;
}

async function getContactById(contactId) {
  const res = await axios.get(
    `${HUBSPOT_BASE}/crm/v3/objects/contacts/${contactId}?properties=email,firstname,lastname,phone,dba,legal_business_name,owned_locations`,
    { headers: hubspotHeaders }
  );
  return res.data;
}

async function searchClosedWonDealsSince(lastPollTime) {
  const searchBody = {
    filterGroups: [
      {
        filters: [
          {
            propertyName: 'hs_is_closed_won',
            operator: 'EQ',
            value: process.env.HUBSPOT_IS_CLOSED_WON,
          },
          {
            propertyName: 'hs_lastmodifieddate',
            operator: 'GTE',
            value: lastPollTime,
          },
        ],
      },
    ],
    properties: [
      'dealname',
      'dealstage',
      'hs_lastmodifieddate',
      'hs_is_closed_won',
    ],
    sorts: [
      {
        propertyName: 'hs_lastmodifieddate',
        direction: 'ASCENDING',
      },
    ],
    limit: 100,
  };

  const res = await axios.post(
    `${HUBSPOT_BASE}/crm/v3/objects/0-3/search`,
    searchBody,
    { headers: hubspotHeaders }
  );

  return res.data.results || [];
}

module.exports = {
  getDealById,
  getCompanyById,
  getContactById,
  searchClosedWonDealsSince,
};