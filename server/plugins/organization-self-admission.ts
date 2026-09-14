import {
  defineNitroPlugin,
  getH3App,
  getSession,
} from "@agent-native/core/server";
import { createError, defineEventHandler, getMethod } from "h3";

import { blocksOrganizationSelfAdmission } from "../organization-request-policy";

export default defineNitroPlugin((nitroApp) => {
  getH3App(nitroApp).use(
    "/_agent-native/org",
    defineEventHandler(async (event) => {
      // Anonymous callers continue to the framework auth handler and receive its
      // normal 401 response. This plugin precedes the org prefix fallback.
      if (!(await getSession(event))) return;
      const pathname = event.context._mountedPathname ?? "";
      if (blocksOrganizationSelfAdmission(getMethod(event), pathname)) {
        throw createError({
          statusCode: 403,
          statusMessage: "Organization membership requires an invitation",
        });
      }
    }),
  );
});
