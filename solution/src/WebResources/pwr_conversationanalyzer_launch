/* Conversation Analyzer - supported launch helper (form-side JS web resource).
 *
 * SUPPORTED ROUTE. Wire this up as a library on the msdyn_ocliveworkitem
 * ("Conversation") form and call Pwr.ConversationAnalyzer.openForRecord from a
 * command bar button's JavaScript action (Function Name:
 * "Pwr.ConversationAnalyzer.openForRecord", Parameters: PrimaryControl).
 *
 * Uses the officially documented Xrm.Navigation.navigateTo custom-page mechanism:
 * https://learn.microsoft.com/power-apps/developer/model-driven-apps/clientapi/reference/xrm-navigation/navigateto
 * The custom page reads the value back via Param("recordId") / Param("entityName") -
 * these are NOT query-string parameters and are not affected by the "custom pages
 * reject extra URL parameters" limitation described in the README.
 *
 * This file is additive - it ships in the solution, but is not wired onto any form or
 * command bar by the solution import, because doing so would risk overwriting a
 * customer's own copy of the Conversation form/command bar. See
 * docs/setup-app-profile.md for the one-time wiring steps.
 */
"use strict";
var Pwr = window.Pwr || {};

Pwr.ConversationAnalyzer = (function () {
  // Environment variable holding the Conversation Analyzer custom page's logical
  // name. Custom pages get a random suffix from the maker portal, so this cannot be
  // hardcoded - see docs/setup-app-profile.md.
  var PAGE_NAME_ENV_VAR = "pwr_ConversationAnalyzerPageName";
  var CONVERSATION_ENTITY = "msdyn_ocliveworkitem";

  function getGlobalXrm() {
    return (typeof Xrm !== "undefined" && Xrm) || (window.parent && window.parent.Xrm) || window.Xrm;
  }

  function getEnvironmentVariable(xrm, schemaName) {
    return xrm.WebApi.retrieveMultipleRecords(
      "environmentvariabledefinition",
      "?$select=defaultvalue&$filter=schemaname eq '" + schemaName + "'" +
      "&$expand=environmentvariabledefinition_environmentvariablevalue($select=value)"
    ).then(function (result) {
      var def = result.entities && result.entities[0];
      if (!def) return "";
      var values = def.environmentvariabledefinition_environmentvariablevalue;
      var current = values && values[0] && values[0].value;
      return (current && current.trim()) || def.defaultvalue || "";
    });
  }

  /**
   * Opens the Conversation Analyzer custom page for the record currently loaded on
   * the form, in a centered dialog, using the supported navigateTo recordId/entityName
   * mechanism. Errors are surfaced with Xrm.Navigation.openErrorDialog rather than
   * swallowed, so a missing environment variable or navigation failure is visible.
   * @param {object} primaryControl - the form context passed by the command bar
   *   (Ribbon Workbench / modern command designer "PrimaryControl" parameter), or a
   *   formContext obtained any other supported way.
   */
  function openForRecord(primaryControl) {
    var xrm = getGlobalXrm();
    if (!xrm || !xrm.Navigation || !xrm.WebApi) {
      console.error("[pwr-conversationanalyzer-launch] Xrm client API is not available.");
      return Promise.reject(new Error("Xrm client API is not available."));
    }
    var formContext = primaryControl && primaryControl.data ? primaryControl : (xrm.Page || primaryControl);
    var entityId;
    try {
      entityId = formContext.data.entity.getId().replace(/[{}]/g, "");
    } catch (err) {
      xrm.Navigation.openErrorDialog({ message: "Could not read the current record id: " + err.message });
      return Promise.reject(err);
    }

    return getEnvironmentVariable(xrm, PAGE_NAME_ENV_VAR).then(function (pageName) {
      if (!pageName) {
        var message = "Set the " + PAGE_NAME_ENV_VAR + " environment variable to your Conversation Analyzer custom page's logical name first (docs/setup-app-profile.md).";
        xrm.Navigation.openErrorDialog({ message: message });
        var envErr = new Error(message);
        envErr.pwrHandled = true;
        throw envErr;
      }
      return xrm.Navigation.navigateTo(
        { pageType: "custom", name: pageName, entityName: CONVERSATION_ENTITY, recordId: entityId },
        { target: 2, position: 1, width: { value: 720, unit: "px" }, title: "Conversation Analyzer" }
      );
    }).catch(function (err) {
      // Already surfaced above for the missing-env-var case; anything else (e.g. a
      // navigateTo rejection) still needs a visible dialog rather than a silent no-op.
      if (err && err.pwrHandled !== true) {
        xrm.Navigation.openErrorDialog({ message: "Could not open Conversation Analyzer: " + (err.message || err) });
      }
      throw err;
    });
  }

  /**
   * Command bar "Enable Rule" helper: only show the button on the Conversation
   * entity. Safe to point a Ribbon Workbench/command designer display rule at this.
   */
  function isConversationRecord(primaryControl) {
    try {
      var formContext = primaryControl && primaryControl.data ? primaryControl : (Xrm.Page || primaryControl);
      return formContext.data.entity.getEntityName() === CONVERSATION_ENTITY;
    } catch (err) {
      console.error("[pwr-conversationanalyzer-launch] isConversationRecord failed", err);
      return false;
    }
  }

  return { openForRecord: openForRecord, isConversationRecord: isConversationRecord };
})();
