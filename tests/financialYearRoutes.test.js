const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const router = require("../routes/financialYearRoutes");

const routes = router.stack
  .filter((layer) => layer.route)
  .map((layer) => ({ path: layer.route.path, methods: Object.keys(layer.route.methods), handlers: layer.route.stack.length }));

test("static default and resolve routes precede the dynamic id route", () => {
  const paths = routes.map((route) => route.path);
  assert.ok(paths.indexOf("/default") < paths.indexOf("/:id"));
  assert.ok(paths.indexOf("/resolve") < paths.indexOf("/:id"));
  assert.deepEqual(paths, ["/", "/default", "/resolve", "/:id/events", "/:id", "/", "/:id/default"]);
});

test("route surface contains only approved reads and owner-protected writes", () => {
  assert.deepEqual(routes.map(({ path, methods }) => [path, methods[0]]), [
    ["/", "get"],
    ["/default", "get"],
    ["/resolve", "get"],
    ["/:id/events", "get"],
    ["/:id", "get"],
    ["/", "post"],
    ["/:id/default", "post"],
  ]);
  assert.equal(routes.find((route) => route.path === "/" && route.methods[0] === "post").handlers, 2);
  assert.equal(routes.find((route) => route.path === "/:id/default").handlers, 2);
  assert.equal(routes.some((route) => ["put", "patch", "delete"].includes(route.methods[0])), false);
});

test("index mounts FY routes behind authentication and subscription enforcement scope", () => {
  const source = fs.readFileSync(path.join(root, "index.js"), "utf8");
  assert.match(source, /"\/api\/financial-years",\s*authMiddleware,\s*financialYearRoutes/);
  assert.match(source, /tenantErpRoutePrefixes = \[[\s\S]*"\/api\/financial-years"/);
});

test("owner authorization rejects staff writes and allows owner writes", () => {
  const makeRes = () => ({ statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  const writeRoutes = router.stack.filter((layer) => layer.route?.methods.post);
  assert.equal(writeRoutes.length, 2);
  for (const layer of writeRoutes) {
    const authorization = layer.route.stack[0].handle;
    const staffRes = makeRes();
    let staffNext = 0;
    authorization({ user: { role: "staff", access_role: "accountant" }, method: "POST" }, staffRes, () => { staffNext += 1; });
    assert.equal(staffRes.statusCode, 403);
    assert.equal(staffNext, 0);
    const ownerRes = makeRes();
    let ownerNext = 0;
    authorization({ user: { role: "owner", access_role: "owner" }, method: "POST" }, ownerRes, () => { ownerNext += 1; });
    assert.equal(ownerNext, 1);
  }
});
