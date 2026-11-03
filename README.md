# ai-automation

Small, working AI automations: a trigger, one LLM call per item, a useful output, and every call's cost logged.

```
input rows → prompt per row → callLLM() → output
                                  └──► usage log: org_id | model | tokens | cost
```

## Automations

| Folder | What it does | Stack |
|---|---|---|
| [`ai-outreach-leads/`](ai-outreach-leads/) | A CSV of leads goes in, Claude writes a personalized cold email for each, and tokens + cost are logged per organization | Node.js, TypeScript, Claude API |

## Principles

- **One function for every AI call** (`callLLM()`): cost logging, and later retries, rate limits and prompt versions, live in one place.
- **Log every call's cost.** Costs vary per call, so averages hide the expensive ones.
- **Look at the output.** Each automation's README lists what I noticed when reading the results.

## Run any automation

Each folder is self-contained:

```
cd <folder>
npm install
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
```

Then follow that folder's README.

`.env` files are git-ignored. Never commit an API key.
