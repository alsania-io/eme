// EME Phase 4: ACL bridge tests. Proves @alsania-io/acl enforcement reaches the
// SecretStore CanAccess hook (default-deny) and namespace gating.

import { Acl, PermBits } from "@alsania-io/acl";
import { aclCanAccess, canAccessNamespace, agentPrincipal } from "../src/acl-bridge.js";
import type { SecretMeta } from "../src/secret-store.js";

const meta = (name: string, namespace = "default"): SecretMeta => ({
  name,
  namespace,
  tags: [],
  createdAt: 0,
  updatedAt: 0,
});

describe("aclCanAccess — default deny", () => {
  test("denies when no ACL entry exists", () => {
    const can = aclCanAccess(new Acl());
    expect(can(meta("MY_API_KEY"), "alice")).toBe(false);
  });
});

describe("aclCanAccess — secret grant", () => {
  test("allows the granted agent, denies others", () => {
    const acl = new Acl();
    acl.grantPermission({ type: "user", id: "alice" }, { type: "secret", id: "MY_API_KEY" }, { permBits: PermBits.VIEW });
    const can = aclCanAccess(acl);
    expect(can(meta("MY_API_KEY"), "alice")).toBe(true);
    expect(can(meta("MY_API_KEY"), "bob")).toBe(false);
  });

  test("CALL alone is not enough for a secret read (needs VIEW)", () => {
    const acl = new Acl();
    acl.grantPermission({ type: "user", id: "alice" }, { type: "secret", id: "K" }, { permBits: PermBits.CALL });
    expect(aclCanAccess(acl)(meta("K"), "alice")).toBe(false);
  });
});

describe("aclCanAccess — namespace gating", () => {
  test("with requireNamespace, needs BOTH secret and namespace VIEW", () => {
    const acl = new Acl();
    acl.grantPermission({ type: "user", id: "alice" }, { type: "secret", id: "K" }, { permBits: PermBits.VIEW });
    const can = aclCanAccess(acl, { requireNamespace: true });
    expect(can(meta("K", "team"), "alice")).toBe(false); // no namespace grant
    acl.grantPermission({ type: "user", id: "alice" }, { type: "namespace", id: "team" }, { permBits: PermBits.VIEW });
    expect(can(meta("K", "team"), "alice")).toBe(true);
  });
});

describe("canAccessNamespace", () => {
  test("checks namespace bits directly", () => {
    const acl = new Acl();
    acl.grantPermission({ type: "group", id: "devs" }, { type: "namespace", id: "team" }, { permBits: PermBits.VIEW | PermBits.EDIT });
    expect(canAccessNamespace(acl, "alice", "team", PermBits.VIEW)).toBe(false); // no group passed
    expect(acl.checkPermission({ type: "user", id: "alice" }, { type: "namespace", id: "team" }, PermBits.VIEW, ["devs"])).toBe(true);
  });

  test("agentPrincipal maps undefined to public", () => {
    expect(agentPrincipal()).toEqual({ type: "public" });
    expect(agentPrincipal("aegis")).toEqual({ type: "user", id: "aegis" });
  });
});