# ai-outreach

A CSV of leads goes in. Claude writes a personalized cold email for each lead, and every AI call's tokens and cost are logged per organization.

```
leads.csv → buildPrompt(lead) → callLLM() → email
                                    └──► usage log: org_id | model | input_tokens | output_tokens | cost
```

All AI calls go through one function, `callLLM()`, which is where cost logging lives.

## Run

```
npm install
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
npx tsx index.ts
```

## Sample output (5 fake leads, Claude Opus 5.5)

```text
===== Ana Petrović =====
Subject: Support for Brightline's move into Germany

Hi Ana,

I read that Brightline Logistics is expanding to Germany next quarter, and I imagine much of the operational groundwork is landing on your desk right now. At ToTheMoon, we offer Logistics from ToTheMoon, a service that helps operations teams set up and run shipping, warehousing, and carrier coordination in new markets. We could take some of that setup work off your team so they can stay focused on keeping current operations running smoothly. Would you be open to a 20-minute call next week to see whether it fits your plans?

Best regards,
Isidora Moon
ToTheMoon

===== Marko Ilić =====
Subject: Logistics support after your Series A

Hi Marko,

Congratulations on Finova's Series A. Growth after a raise often means more equipment, hardware, and materials moving between offices, partners, and new hires, and that work tends to land on the CTO's desk. At ToTheMoon, we handle that logistics end to end so your team can stay focused on building the product. Would you be open to a 15-minute call next week to see whether it's a fit?

Best,
Isidora Moon
ToTheMoon

===== Sofia Lindqvist =====
Subject: Logistics for your new online shop

Hi Sofia,

I saw that Nordhaus Furniture launched its new online shop in September, and I imagine shipping large, heavy items is a growing part of your work. At ToTheMoon, we handle logistics for furniture retailers, including warehousing, delivery scheduling, and returns. We could take some of that load off your team so you can focus on the shop itself. Would you be open to a short call next week to see if it makes sense for Nordhaus?

Best regards,
Isidora Moon
ToTheMoon

===== Daniel Okafor =====
**Subject:** Supplying Medlink's five new clinics

Hi Daniel,

I saw that Medlink Clinics is opening five new clinics this year, which likely means a lot of equipment and supplies need to reach each site on schedule. I'm Isidora Moon from ToTheMoon, and our Logistics from ToTheMoon service handles shipping, tracking, and delivery coordination for organizations setting up new locations. We can give your team a clear view of where every order is and when it will arrive, so setup work isn't held up by missing items. Would you be open to a 15-minute call next week to see if this could help with your openings?

Best regards,
Isidora Moon
ToTheMoon

===== Elena Rossi =====
Hi Elena,

I saw that Verde Foods is hiring three sales reps, which usually means more orders and more deliveries to coordinate soon. I'm Isidora Moon from ToTheMoon, and we handle logistics for food companies, including warehousing, order fulfillment, and delivery scheduling. If your current setup might feel stretched as new accounts come in, we could take some of that work off your team's plate. Would you be open to a 15-minute call next week to see if it makes sense?

Best regards,
Isidora Moon
ToTheMoon
```

## Cost log

```text
┌─────────┬────────┬───────────────────┬──────────────┬───────────────┬──────────┐
│ (index) │ org_id │ model             │ input_tokens │ output_tokens │ cost     │
├─────────┼────────┼───────────────────┼──────────────┼───────────────┼──────────┤
│ 0       │ 'acme' │ 'claude-opus-5-5' │ 137          │ 277           │ 0.006088 │
│ 1       │ 'acme' │ 'claude-opus-5-5' │ 125          │ 263           │ 0.00576  │
│ 2       │ 'acme' │ 'claude-opus-5-5' │ 142          │ 239           │ 0.005348 │
│ 3       │ 'acme' │ 'claude-opus-5-5' │ 134          │ 545           │ 0.011436 │
│ 4       │ 'acme' │ 'claude-opus-5-5' │ 133          │ 304           │ 0.006612 │
└─────────┴────────┴───────────────────┴──────────────┴───────────────┴──────────┘
Total: $0.0352 for 5 emails
```

Costs are in USD, from Anthropic's per-million-token prices. Output tokens include the model's thinking.
