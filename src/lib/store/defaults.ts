import type {
  GenerationParams,
  PromptPreset,
  SlashCommand,
  ThinkingConfig,
  ThinkingEffort,
} from '@/types';
import { uid } from '@/lib/utils/id';

export const DEFAULT_PARAMS: GenerationParams = {
  temperature: 0.7,
  topP: 0.9,
  topK: 40,
  repeatPenalty: 1.1,
  contextLength: 131072,
  maxTokens: -1,
};

/**
 * Thinking is on at `medium` for every new conversation. The send path gates on
 * `providerSupportsThinking()` (see use-chat.ts), so a provider without a
 * reasoning parameter simply never receives one — turning this on cannot produce
 * a bad request. Existing conversations keep whatever they were created with.
 */
export const DEFAULT_THINKING: ThinkingConfig = {
  enabled: true,
  effort: 'high',
};

/** Ordered thinking effort levels — used to render the selector. */
export const THINKING_EFFORTS: ThinkingEffort[] = ['low', 'medium', 'high', 'max'];

export const DEFAULT_SYSTEM_PROMPT = `You are a helpful, knowledgeable AI assistant. Your goal is to give accurate, well-structured answers that directly solve the user's problem.

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
 * Runtime-themeable graphite accents. All values are grayscale so user choice
 * stays inside the monochrome product system.
 *
 *   rgb    accent TEXT, icons, rails, carets. Must clear 4.5:1 on the field.
 *   soft   hover / secondary tint, one step brighter.
 *   solid  accent FILLS, which carry night ink on top. Because every value here
 *          already clears 4.5:1 on the field, the same colour serves both — the
 *          old palette needed a separate near-white fill and this one does not.
 *   ember  the hot second stop, for the two gradients and the lamp pools.
 *
 * Lamp (#FFB65C, 11.1:1) is the default and the one the system is designed
 * around; the rest are the same construction in another hue.
 */
export const ACCENT_PRESETS: {
  name: string;
  value: string;
  rgb: string;
  soft: string;
  solid: string;
  ember: string;
}[] = [
  {
    name: 'Graphite',
    value: 'lamp',
    rgb: '24 24 22',
    soft: '72 72 67',
    solid: '24 24 22',
    ember: '82 82 76',
  },
  {
    name: 'Carbon',
    value: 'ember',
    rgb: '48 48 44',
    soft: '88 88 81',
    solid: '48 48 44',
    ember: '104 104 96',
  },
  {
    name: 'Steel',
    value: 'mint',
    rgb: '61 65 67',
    soft: '99 104 106',
    solid: '61 65 67',
    ember: '116 121 123',
  },
  {
    name: 'Ash',
    value: 'sky',
    rgb: '86 85 80',
    soft: '118 117 110',
    solid: '86 85 80',
    ember: '134 132 124',
  },
  {
    name: 'Silver',
    value: 'lilac',
    rgb: '76 75 71',
    soft: '106 105 99',
    solid: '76 75 71',
    ember: '132 130 123',
  },
  {
    name: 'Chalk',
    value: 'linen',
    rgb: '94 93 88',
    soft: '124 122 116',
    solid: '94 93 88',
    ember: '146 144 136',
  },
];

export const DEFAULT_PRESETS: PromptPreset[] = [
  { id: uid(), name: 'Default Assistant', content: DEFAULT_SYSTEM_PROMPT },
  {
    id: uid(),
    name: 'Senior Engineer',
    content: `You are a senior staff software engineer doing a careful code review and pairing session. You optimize for correctness, clarity, and long-term maintainability.

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
    content: `You are a concise expert assistant. Maximize signal, minimize words.

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
    content: `You are an expert full-stack web developer specializing in modern TypeScript, React, and Next.js.

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
