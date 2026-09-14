import { describe, expect, it } from "vitest";

import { blocksOrganizationSelfAdmission } from "../../../server/organization-request-policy";

describe("organization self-admission request policy", () => {
  it.each([
    "/_agent-native/org",
    "/_agent-native/org/",
    "/_agent-native/org/unmatched-framework-tail",
    "/_agent-native/org/join-by-domain",
  ])("blocks framework organization creation surface %s", (pathname) => {
    expect(blocksOrganizationSelfAdmission("POST", pathname)).toBe(true);
  });

  it.each([
    ["GET", "/_agent-native/org/me"],
    ["PUT", "/_agent-native/org/switch"],
    ["POST", "/_agent-native/org/invitations"],
    ["POST", "/_agent-native/org/invitations/invite_1/accept"],
    ["POST", "/_agent-native/org/a2a-secret/sync"],
    ["POST", "/_agent-native/org/a2a-secret/receive"],
    ["POST", "/_agent-native/organization"],
  ])("does not overblock %s %s", (method, pathname) => {
    expect(blocksOrganizationSelfAdmission(method, pathname)).toBe(false);
  });
});
