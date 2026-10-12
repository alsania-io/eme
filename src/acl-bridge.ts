// EME Storage Router — Phase 4: ACL bridge.
// Adapts @alsania-io/acl (the shared, extracted package) to the SecretStore's
// `CanAccess` hook and to namespace checks. This is the extension seam —
// secret-store.ts is NOT edited; the ACL model lives in the shared package.
//
// Resource mapping:
//   secret    -> { type: "secret",    id: name }
//   namespace -> { type: "namespace", id: namespace }
// Enforcement is default-deny (Acl.checkPermission returns false with no entry).

import { Acl, PermBits, Principal, Resource } from "@alsania-io/acl";
import type { CanAccess, SecretMeta } from "./secret-store.js";

/** Agent ids are treated as `user` principals. Override for group/public use. */
export function agentPrincipal(agentId?: string): Principal {
  return agentId ? { type: "user", id: agentId } : { type: "public" };
}

/**
 * Build a `CanAccess` hook backed by an Acl. An agent may read a secret iff it
 * holds VIEW on { type:"secret", id: name }. Namespace scoping is honored by
 * also requiring VIEW on { type:"namespace", id: namespace } WHEN the acl has
 * any namespace entry (so pure secret-only grants still work).
 */
export function aclCanAccess(acl: Acl, opts: { requireNamespace?: boolean } = {}): CanAccess {
  const requireNamespace = opts.requireNamespace ?? false;
  return (secret: SecretMeta, agentId?: string): boolean => {
    const principal = agentPrincipal(agentId);
    const secretRes: Resource = { type: "secret", id: secret.name };
    if (!acl.checkPermission(principal, secretRes, PermBits.VIEW)) return false;
    if (requireNamespace) {
      const nsRes: Resource = { type: "namespace", id: secret.namespace };
      if (!acl.checkPermission(principal, nsRes, PermBits.VIEW)) return false;
    }
    return true;
  };
}

/** Convenience: may `agentId` access `namespace` at `required` bits? */
export function canAccessNamespace(
  acl: Acl,
  agentId: string | undefined,
  namespace: string,
  required: number = PermBits.VIEW,
): boolean {
  return acl.checkPermission(agentPrincipal(agentId), { type: "namespace", id: namespace }, required);
}