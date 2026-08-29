const assert = require("node:assert/strict");
const test = require("node:test");
const { buildBusinessContextResponse } = require("../controllers/businessController");

const authenticatedUser = {
  user_id: 13,
  name: "Development Owner",
  email: "dev.owner@revexbooks.com",
  role: "owner",
  access_role: "owner",
  company_id: 4,
  branch_id: 9,
};

test("business context additively exposes verified authenticated user identity", () => {
  const companies = [{ id: 4, name: "RevEx Development" }];
  const branches = [{ id: 9, company_id: 4, name: "Head Office" }];
  const result = buildBusinessContextResponse({ authenticatedUser, companies, branches });

  assert.deepEqual(result.user, {
    id: 13,
    name: "Development Owner",
    email: "dev.owner@revexbooks.com",
    role: "owner",
    access_role: "owner",
  });
  assert.strictEqual(result.companies, companies);
  assert.strictEqual(result.branches, branches);
  assert.equal(result.current_company_id, 4);
  assert.equal(result.current_branch_id, 9);
  assert.equal(result.consolidated, false);
});

test("consolidated context preserves existing fields and maps an id naming fallback", () => {
  const result = buildBusinessContextResponse({
    authenticatedUser: {
      id: 17,
      name: "Development Staff",
      email: "dev.staff@revexbooks.com",
      role: "staff",
      access_role: "sales",
      company_id: 4,
      branch_id: null,
    },
    companies: [],
    branches: [],
  });

  assert.equal(result.user.id, 17);
  assert.deepEqual(result.companies, []);
  assert.deepEqual(result.branches, []);
  assert.equal(result.current_company_id, 4);
  assert.equal(result.current_branch_id, null);
  assert.equal(result.consolidated, true);
});

test("request-supplied identity cannot influence the authenticated response builder", () => {
  const untrustedRequestValues = {
    user_id: 999,
    company_id: 999,
    name: "Untrusted",
  };
  const result = buildBusinessContextResponse({
    authenticatedUser,
    companies: [{ id: 4, name: "RevEx Development" }],
    branches: [],
    query: untrustedRequestValues,
    body: untrustedRequestValues,
  });

  assert.equal(result.user.id, 13);
  assert.equal(result.user.name, "Development Owner");
  assert.equal(result.current_company_id, 4);
});

test("missing optional authenticated identity fields are returned as null, not fabricated", () => {
  const result = buildBusinessContextResponse({
    authenticatedUser: { user_id: 18, company_id: 8, branch_id: null },
    companies: [],
    branches: [],
  });

  assert.deepEqual(result.user, {
    id: 18,
    name: null,
    email: null,
    role: null,
    access_role: null,
  });
});
