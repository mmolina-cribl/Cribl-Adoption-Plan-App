# Adoption Plan — user guide (human pointer)

The **canonical, model-fed user guide** for the Adoption Plan app lives in source as:

- [`src/lib/adoptionPlanAssistantUserGuide.ts`](../src/lib/adoptionPlanAssistantUserGuide.ts) — long-form guide text embedded in the **AI ASSISTANT** system prompt (same content the assistant is instructed to use for in-app “how do I…” questions).

Navigation + shorter UI map + PS worksheet **static definitions** are composed in:

- [`src/lib/adoptionAssistantAppContext.ts`](../src/lib/adoptionAssistantAppContext.ts)

When you change product behavior, labels, or flows, update those files (and any related UI) so the assistant and the app stay aligned.
