import type { Template } from './types'

export const DEFAULT_TEMPLATES: Template[] = [
  {
    id: 'bug',
    name: 'Bug',
    description: 'Report a bug with full interaction context and API details',
    contextScope: 'both',
    isBuiltIn: true,
    body: `Fix the following bug in {element_selector}:

User action:
{interaction_description}
Error: {error_details}

Current page: {url}`,
  },
  {
    id: 'ux',
    name: 'UX',
    description: 'Request a UX improvement for a specific element',
    contextScope: 'element',
    isBuiltIn: true,
    body: `Improve the UX of {element_selector} on {url}.

`,
  },
  {
    id: 'playwright',
    name: 'Playwright',
    description: 'Generate a Playwright TypeScript test that reproduces the recorded interaction',
    contextScope: 'both',
    isBuiltIn: true,
    exclude: ['console', 'api'],
    body: `Write a playwright test script in typescript with the following instruction:

{interaction_description}.

Save a screenshot at the end in the current working directory`,
  },
]
