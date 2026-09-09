-- Xero Client Import (New Handcrafted Food Products / Metanoia Hospitality
-- onboarding) — `companies` only ever had a single free-text `address`
-- (street line) plus `postal_address`, with no city/province/postal
-- code/country columns, unlike `customer_addresses`/`supplier_addresses`
-- which already have that structure (line1/line2/city/region/postal_code/
-- country). The Xero organisation export carries city, province, postal
-- code, and country as distinct fields; cramming them into the one
-- `address` string would lose queryable structure and doesn't match this
-- codebase's own established address-detail pattern. Additive and
-- nullable-safe (defaults to '') — every existing company keeps working
-- unchanged with these blank until explicitly set.
alter table companies
  add column city text not null default '',
  add column province text not null default '',
  add column postal_code text not null default '',
  add column country text not null default '';
