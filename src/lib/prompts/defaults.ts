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
API call: {method} {url} → {status}
Error: {error_details}
{user_text}

Current page: {url}`,
  },
  {
    id: 'ux',
    name: 'UX',
    description: 'Request a UX improvement for a specific element',
    contextScope: 'element',
    isBuiltIn: true,
    body: `Improve the UX of {element_selector} on {url}.

{user_text}`,
  },
]
