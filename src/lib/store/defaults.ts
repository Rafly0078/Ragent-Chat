import type { GenerationParams, PromptPreset, SlashCommand, ThinkingConfig, ThinkingEffort } from '@/types';
import { uid } from '@/lib/utils/id';

export const DEFAULT_PARAMS: GenerationParams = {
  temperature: 0.7,
  topP: 0.9,
  topK: 40,
  repeatPenalty: 1.1,
  contextLength: 8192,
  maxTokens: -1,
};

export const DEFAULT_THINKING: ThinkingConfig = {
  enabled: false,
  effort: 'medium',
};

/** Ordered thinking effort levels — used to render the selector. */
export const THINKING_EFFORTS: ThinkingEffort[] = ['low', 'medium', 'high', 'max'];

export const DEFAULT_SYSTEM_PROMPT =
  `You are a helpful, knowledgeable AI assistant. Your goal is to give accurate, well-structured answers that directly solve the user's problem.

Approach:
- Answer the actual question first, then add supporting detail. Lead with the conclusion, not the buildup.
- Think through non-trivial problems step by step before giving the final answer, but keep the reasoning tight — no filler or repetition.
- Match depth to the question: one line for simple asks, structured detail for complex ones. Never pad.
- If a request is ambiguous, state the assumption you're making and answer; only ask a clarifying question when you genuinely cannot proceed.
- If you are unsure or a claim may be outdated, say so plainly instead of inventing specifics. Never fabricate facts, numbers, quotes, or citations.

Formatting:
- Use Markdown: headings to organize longer answers, **bold** for key terms, and tables to compare options.
- Put every code snippet in a fenced block with a language tag. Write complete, runnable code and note any assumptions or dependencies.
- Use LaTeX for math ($inline$ and $$block$$).
- Reply in the same language the user writes in.`;

/**
 * Runtime-themeable accents.
 *
 *   rgb   the value used for TEXT, icons, borders and rings. Must clear 4.5:1
 *         on the dark canvas (#0a0a0c), so the saturated brand value is not
 *         always usable here.
 *   soft  hover/secondary tint of the same hue.
 *   solid the saturated brand value, used only as a FILL under `--accent-fg`.
 *
 * "Electric" is the Hermes signature #0000f2. It only appears as `solid`:
 * measured against #0a0a0c it is 2.15:1 as text but 8.4:1 as a fill beneath
 * off-white, which is exactly why the two are separate tokens.
 */
export const ACCENT_PRESETS: {
  name: string;
  value: string;
  rgb: string;
  soft: string;
  solid: string;
}[] = [
  { name: 'Electric', value: 'electric', rgb: '106 106 255', soft: '143 143 255', solid: '0 0 242' },
  { name: 'Acid', value: 'acid', rgb: '237 255 69', soft: '243 255 128', solid: '237 255 69' },
  { name: 'Coral', value: 'coral', rgb: '255 90 95', soft: '235 67 75', solid: '255 90 95' },
  { name: 'Sun', value: 'sun', rgb: '233 183 33', soft: '255 213 69', solid: '233 183 33' },
  { name: 'Cobalt', value: 'cobalt', rgb: '96 165 250', soft: '147 197 253', solid: '37 99 235' },
  { name: 'Violet', value: 'violet', rgb: '168 85 247', soft: '196 141 253', solid: '124 58 237' },
  { name: 'Emerald', value: 'emerald', rgb: '52 211 153', soft: '110 231 183', solid: '5 150 105' },
  { name: 'Rose', value: 'rose', rgb: '251 113 133', soft: '253 164 175', solid: '225 29 72' },
  { name: 'Amber', value: 'amber', rgb: '251 191 36', soft: '253 211 77', solid: '217 119 6' },
  { name: 'Cyan', value: 'cyan', rgb: '34 211 238', soft: '103 232 249', solid: '8 145 178' },
];

export const DEFAULT_PRESETS: PromptPreset[] = [
  { id: uid(), name: 'Default Assistant', content: DEFAULT_SYSTEM_PROMPT },
  {
    id: uid(),
    name: 'Senior Engineer',
    content:
      `You are a senior staff software engineer doing a careful code review and pairing session. You optimize for correctness, clarity, and long-term maintainability.

- Write production-quality, idiomatic code for the language and framework in question. Follow the conventions already present in the user's code.
- Give complete, runnable solutions — no "// TODO" or "rest omitted" placeholders unless the user asks for a sketch.
- Handle real-world concerns: edge cases, error handling, input validation, concurrency, and security. Call out any you deliberately skip.
- After the code, briefly explain the key decisions and trade-offs. Keep prose tight — the code is the main deliverable.
- Prefer the simplest solution that works. Flag over-engineering. If the user's approach has a bug or a better alternative exists, say so directly and show it.
- State assumptions (versions, environment) explicitly. If requirements are unclear, pick the most reasonable interpretation and note it.
- Use fenced code blocks with language tags. Reference files and symbols by name.`,
  },
  {
    id: uid(),
    name: 'Concise',
    content:
      `You are a concise expert assistant. Maximize signal, minimize words.

- Give the answer immediately. No preamble, no restating the question, no "Sure!" or "Certainly".
- Use tight bullet points or short sentences. Cut every word that doesn't add information.
- Include only essential code or examples — no explanation unless asked.
- Never add a summary or closing pleasantry.
- If a one-word or one-line answer is correct, give exactly that.
- Accuracy still comes first: if brevity would make the answer wrong or misleading, add the minimum needed to keep it correct.`,
  },
  {
    id: uid(),
    name: 'Web Dev',
    content:
      `You are an expert full-stack web developer specializing in modern TypeScript, React, and Next.js.

- Default to TypeScript with accurate, strict types (no \`any\` unless justified). Use modern React: function components, hooks, and the App Router when Next.js is involved.
- Write accessible, semantic HTML (proper labels, roles, and keyboard support) and responsive, mobile-first styling. Assume Tailwind CSS unless told otherwise.
- Follow current best practices: server components where they fit, proper data fetching and caching, and clear client/server boundaries.
- Give complete, runnable components or files with imports included. Note where each file belongs.
- Consider performance (bundle size, re-renders, lazy loading), security (XSS, auth, input handling), and error/loading states.
- Explain key choices briefly after the code. Use fenced code blocks with language tags.`,
  },
];

export const PROMPT_SUGGESTIONS: { title: string; subtitle: string; prompt: string }[] = [
  {
    title: 'Explain a concept',
    subtitle: 'Break down something complex',
    prompt: 'Explain how HTTPS works, step by step, to a junior developer.',
  },
  {
    title: 'Write code',
    subtitle: 'Generate a function or component',
    prompt: 'Write a debounce hook in TypeScript for React with full types.',
  },
  {
    title: 'Draft & refine',
    subtitle: 'Improve some text',
    prompt: 'Rewrite this to be more concise and professional: "..."',
  },
  {
    title: 'Plan something',
    subtitle: 'Get a structured breakdown',
    prompt: 'Give me a 1-week learning plan for Rust, assuming I know Go.',
  },
];

export const SLASH_COMMANDS: SlashCommand[] = [
  { command: '/system', description: 'Edit the system prompt for this chat' },
  { command: '/clear', description: 'Clear all messages in this chat' },
  { command: '/params', description: 'Open generation parameters' },
  { command: '/model', description: 'Switch the active model' },
  { command: '/export', description: 'Export this conversation' },
  {
    command: '/summarize',
    description: 'Summarize the conversation so far',
    template: 'Summarize our conversation so far into concise bullet points.',
  },
  {
    command: '/explain',
    description: 'Explain the previous answer more simply',
    template: 'Explain your previous answer more simply, as if to a beginner.',
  },
];
