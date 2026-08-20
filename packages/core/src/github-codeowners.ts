export type GitHubCodeOwnerParty =
  | {
      kind: "user";
      login: string;
    }
  | {
      kind: "team";
      organization: string;
      slug: string;
    }
  | {
      kind: "email";
      email: string;
    };

interface CodeOwnerRule {
  pattern: string;
  owners: readonly GitHubCodeOwnerParty[];
}

export function resolveGitHubCodeOwnerParties(
  codeowners: string,
  changedFiles: readonly string[]
): GitHubCodeOwnerParty[] {
  const rules = parseCodeOwnerRules(codeowners);
  const parties = new Map<string, GitHubCodeOwnerParty>();

  for (const changedFile of changedFiles) {
    const matchingRule = findMatchingCodeOwnerRule(rules, changedFile);
    if (!matchingRule) {
      continue;
    }

    for (const party of matchingRule.owners) {
      parties.set(githubCodeOwnerPartyKey(party), party);
    }
  }

  return [...parties.values()];
}

export function countApprovedGitHubCodeOwnerParties(
  parties: readonly GitHubCodeOwnerParty[],
  approvedReviewerLogins: readonly string[],
  approvedTeamMemberLogins: ReadonlyMap<string, readonly string[]>
): number {
  const approvedReviewers = new Set(
    approvedReviewerLogins.map(normalizeGitHubLogin).filter(Boolean)
  );

  return parties.filter((party) => {
    if (party.kind === "user") {
      return approvedReviewers.has(party.login);
    }
    if (party.kind === "email") {
      return false;
    }

    return (approvedTeamMemberLogins.get(githubCodeOwnerPartyKey(party)) ?? []).some((login) =>
      approvedReviewers.has(normalizeGitHubLogin(login))
    );
  }).length;
}

export function githubCodeOwnerPartyKey(party: GitHubCodeOwnerParty): string {
  if (party.kind === "user") {
    return `user:${party.login}`;
  }
  if (party.kind === "team") {
    return `team:${party.organization}/${party.slug}`;
  }
  return `email:${party.email}`;
}

function parseCodeOwnerRules(codeowners: string): CodeOwnerRule[] {
  return codeowners
    .split(/\r?\n/)
    .map(parseCodeOwnerRule)
    .filter((rule): rule is CodeOwnerRule => rule !== null);
}

function parseCodeOwnerRule(line: string): CodeOwnerRule | null {
  const fields = splitCodeOwnersLine(line);
  const [pattern, ...ownerFields] = fields;
  if (!pattern || pattern.startsWith("!") || ownerFields.length === 0) {
    return null;
  }

  const owners = ownerFields
    .map(parseGitHubCodeOwnerParty)
    .filter((party): party is GitHubCodeOwnerParty => party !== null);
  return owners.length > 0 ? { pattern, owners } : null;
}

function splitCodeOwnersLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let escaped = false;

  for (const character of line) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "#") {
      break;
    }
    if (/\s/.test(character)) {
      if (current) {
        fields.push(current);
        current = "";
      }
      continue;
    }
    current += character;
  }

  if (escaped) {
    current += "\\";
  }
  if (current) {
    fields.push(current);
  }

  return fields;
}

function parseGitHubCodeOwnerParty(value: string): GitHubCodeOwnerParty | null {
  if (value.startsWith("@")) {
    const parts = value.slice(1).split("/").map(normalizeGitHubLogin);
    if (parts.length === 1 && parts[0]) {
      return { kind: "user", login: parts[0] };
    }
    if (parts.length === 2 && parts[0] && parts[1]) {
      return { kind: "team", organization: parts[0], slug: parts[1] };
    }
    return null;
  }

  const email = value.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+$/.test(email) ? { kind: "email", email } : null;
}

function findMatchingCodeOwnerRule(
  rules: readonly CodeOwnerRule[],
  changedFile: string
): CodeOwnerRule | null {
  let matchingRule: CodeOwnerRule | null = null;
  for (const rule of rules) {
    if (matchesCodeOwnerPattern(rule.pattern, changedFile)) {
      matchingRule = rule;
    }
  }
  return matchingRule;
}

function matchesCodeOwnerPattern(pattern: string, changedFile: string): boolean {
  const normalizedPath = changedFile.replace(/^\/+/, "");
  const anchored = pattern.startsWith("/");
  const normalizedPattern = pattern.replace(/^\/+/, "");
  if (!normalizedPattern) {
    return false;
  }

  const isDirectoryPattern = normalizedPattern.endsWith("/");
  const patternWithoutDirectorySuffix = isDirectoryPattern
    ? normalizedPattern.slice(0, -1)
    : normalizedPattern;
  const needsAnyDirectoryPrefix = !anchored && !patternWithoutDirectorySuffix.includes("/");
  const hasGlob = /[*?]/.test(patternWithoutDirectorySuffix);
  const regularExpression = new RegExp(
    `^${needsAnyDirectoryPrefix ? "(?:.*/)?" : ""}${globToRegularExpression(
      patternWithoutDirectorySuffix
    )}${isDirectoryPattern || !hasGlob ? "(?:/.*)?" : ""}$`
  );
  return regularExpression.test(normalizedPath);
}

function globToRegularExpression(pattern: string): string {
  let source = "";

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (!character) {
      continue;
    }
    if (character === "*") {
      const nextCharacter = pattern[index + 1];
      if (nextCharacter === "*") {
        const characterAfterGlobStar = pattern[index + 2];
        if (characterAfterGlobStar === "/") {
          source += "(?:.*/)?";
          index += 2;
        } else {
          source += ".*";
          index += 1;
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (character === "?") {
      source += "[^/]";
      continue;
    }
    source += escapeRegularExpressionCharacter(character);
  }

  return source;
}

function escapeRegularExpressionCharacter(value: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(value) ? `\\${value}` : value;
}

function normalizeGitHubLogin(value: string): string {
  return value.trim().toLowerCase();
}
