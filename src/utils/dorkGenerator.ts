export const DORK_TARGET_OPTIONS = [
  'General OSINT',
  'Social Media',
  'Vulnerable Servers',
  'Documents/Leaks',
] as const;

export type DorkTargetType = (typeof DORK_TARGET_OPTIONS)[number];

export const DORK_SYSTEM_PROMPT =
  'You are an elite OSINT investigator. You will receive raw text extracted from an image (like a name, email, location, or company).\n' +
  'Generate exactly 10 highly advanced Google Dorks based on the target type selected.\n' +
  'Use advanced operators: site:, inurl:, filetype:, intitle:, intext:.\n' +
  'Example for an email: \'site:pastebin.com "email@domain.com"\', \'filetype:pdf "email@domain.com"\', \'inurl:admin "domain.com"\'\n' +
  'Output ONLY the list of 10 dorks. No explanation, no markdown formatting, just the raw strings.';

/**
 * Formats the user prompt sent to the LLM with the selected target category
 * and the upstream text extracted from OcrNode, ExifNode, or ChatNode.
 */
export function buildDorkUserPrompt(
  targetType: DorkTargetType,
  extractedSourceText: string,
): string {
  return (
    `Target Type: ${targetType}\n\n` +
    `Extracted Source Text:\n${extractedSourceText.trim()}`
  );
}

/**
 * Parses the raw LLM response into clean Google Dork query strings, stripping
 * accidental markdown fences, numbering, or outer single quotes while capping at 10.
 */
export function parseDorkListResponse(rawOutput: string): string[] {
  const cleanedLines = rawOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('```'))
    .map((line) => line.replace(/^\d+[.)]\s+/, '').replace(/^[-*]\s+/, '').trim())
    .map((line) => {
      if (line.startsWith("'") && line.endsWith("'") && line.length >= 2) {
        return line.slice(1, -1).trim();
      }
      return line;
    })
    .filter((line) => line.length > 0);

  const unique: string[] = [];
  for (const dork of cleanedLines) {
    if (!unique.includes(dork)) {
      unique.push(dork);
    }
    if (unique.length >= 10) break;
  }
  return unique;
}

/**
 * Builds a Google Search URL that executes the given dork query in a new tab.
 */
export function buildGoogleSearchUrl(dorkQuery: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(dorkQuery.trim())}`;
}
