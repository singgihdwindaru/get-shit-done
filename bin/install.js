#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const crypto = require('crypto');

// Colors
const cyan = '\x1b[36m';
const green = '\x1b[32m';
const yellow = '\x1b[33m';
const dim = '\x1b[2m';
const reset = '\x1b[0m';

// Copilot instructions marker constants
const GSD_COPILOT_INSTRUCTIONS_MARKER = '<!-- GSD Configuration \u2014 managed by get-shit-done installer -->';
const GSD_COPILOT_INSTRUCTIONS_CLOSE_MARKER = '<!-- /GSD Configuration -->';

// Copilot tool name mapping — Claude Code tools to GitHub Copilot tools
// Tool mapping applies ONLY to agents, NOT to skills (per CONTEXT.md decision)
const claudeToCopilotTools = {
  Read: 'read',
  Write: 'edit',
  Edit: 'edit',
  Bash: 'execute',
  Grep: 'search',
  Glob: 'search',
  Task: 'agent',
  WebSearch: 'web',
  WebFetch: 'web',
  TodoWrite: 'todo',
  AskUserQuestion: 'ask_user',
  SlashCommand: 'skill',
};

// Get version from package.json
const pkg = require('../package.json');

// Parse args
const args = process.argv.slice(2);
const hasGlobal = args.includes('--global') || args.includes('-g');
const hasLocal = args.includes('--local') || args.includes('-l');
const hasCopilot = args.includes('--copilot');
const hasSdk = args.includes('--sdk');
const hasUninstall = args.includes('--uninstall') || args.includes('-u');

// WSL + Windows Node.js detection
// When Windows-native Node runs on WSL, os.homedir() and path.join() produce
// backslash paths that don't resolve correctly on the Linux filesystem.
if (process.platform === 'win32') {
  let isWSL = false;
  try {
    if (process.env.WSL_DISTRO_NAME) {
      isWSL = true;
    } else if (fs.existsSync('/proc/version')) {
      const procVersion = fs.readFileSync('/proc/version', 'utf8').toLowerCase();
      if (procVersion.includes('microsoft') || procVersion.includes('wsl')) {
        isWSL = true;
      }
    }
  } catch {
    // Ignore read errors — not WSL
  }

  if (isWSL) {
    console.error(`
${yellow}⚠ Detected WSL with Windows-native Node.js.${reset}

This causes path resolution issues that prevent correct installation.
Please install a Linux-native Node.js inside WSL:

  curl -fsSL https://fnm.vercel.app/install | bash
  fnm install --lts

Then re-run: npx get-shit-done-cc@latest
`);
    process.exit(1);
  }
}

// Helper to get directory name for a runtime (used for local/project installs)
function getDirName(runtime) {
  return '.github';
}

/**
 * Get the config directory path relative to home directory for a runtime
 */
function getConfigDirFromHome(runtime, isGlobal) {
  if (!isGlobal) {
    return "'.github'";
  }
  return "'.copilot'";
}


/**
 * Get the global config directory for a runtime
 * @param {string} runtime - 'copilot'
 * @param {string|null} explicitDir - Explicit directory from --config-dir flag
 */
function getGlobalDir(runtime, explicitDir = null) {
  // Copilot: --config-dir > COPILOT_CONFIG_DIR > ~/.copilot
  if (explicitDir) {
    return expandTilde(explicitDir);
  }
  if (process.env.COPILOT_CONFIG_DIR) {
    return expandTilde(process.env.COPILOT_CONFIG_DIR);
  }
  return path.join(os.homedir(), '.copilot');
}

const banner = '\n' +
  cyan + '   ██████╗ ███████╗██████╗\n' +
  '  ██╔════╝ ██╔════╝██╔══██╗\n' +
  '  ██║  ███╗███████╗██║  ██║\n' +
  '  ██║   ██║╚════██║██║  ██║\n' +
  '  ╚██████╔╝███████║██████╔╝\n' +
  '   ╚═════╝ ╚══════╝╚═════╝' + reset + '\n' +
  '\n' +
  '  Get Shit Done ' + dim + 'v' + pkg.version + reset + '\n' +
  '  A meta-prompting, context engineering and spec-driven\n' +
  '  development system for GitHub Copilot by TÂCHES.\n';

// Parse --config-dir argument
function parseConfigDirArg() {
  const configDirIndex = args.findIndex(arg => arg === '--config-dir' || arg === '-c');
  if (configDirIndex !== -1) {
    const nextArg = args[configDirIndex + 1];
    // Error if --config-dir is provided without a value or next arg is another flag
    if (!nextArg || nextArg.startsWith('-')) {
      console.error(`  ${yellow}--config-dir requires a path argument${reset}`);
      process.exit(1);
    }
    return nextArg;
  }
  // Also handle --config-dir=value format
  const configDirArg = args.find(arg => arg.startsWith('--config-dir=') || arg.startsWith('-c='));
  if (configDirArg) {
    const value = configDirArg.split('=')[1];
    if (!value) {
      console.error(`  ${yellow}--config-dir requires a non-empty path${reset}`);
      process.exit(1);
    }
    return value;
  }
  return null;
}
const explicitConfigDir = parseConfigDirArg();
const hasHelp = args.includes('--help') || args.includes('-h');
const forceStatusline = args.includes('--force-statusline');

console.log(banner);

if (hasUninstall) {
  console.log('  Mode: Uninstall\n');
}

// Show help if requested
if (hasHelp) {
  console.log(`  ${yellow}Usage:${reset} npx get-shit-done-cc [options]\n\n  ${yellow}Options:${reset}\n    ${cyan}-g, --global${reset}              Install globally (to ~/.copilot)\n    ${cyan}-l, --local${reset}               Install locally (to current directory)\n    ${cyan}--copilot${reset}                 Install for GitHub Copilot\n    ${cyan}--sdk${reset}                     Also install GSD SDK CLI (gsd-sdk)\n    ${cyan}-u, --uninstall${reset}           Uninstall GSD (remove all GSD files)\n    ${cyan}-c, --config-dir <path>${reset}   Specify custom config directory\n    ${cyan}-h, --help${reset}                Show this help message\n    ${cyan}--force-statusline${reset}        Replace existing statusline config\n\n  ${yellow}Examples:${reset}\n    ${dim}# Interactive install (prompts for location)${reset}\n    npx get-shit-done-cc\n\n    ${dim}# Install for Copilot globally${reset}\n    npx get-shit-done-cc --global\n\n    ${dim}# Install for Copilot locally${reset}\n    npx get-shit-done-cc --local\n\n    ${dim}# Install to custom config directory${reset}\n    npx get-shit-done-cc --global --config-dir ~/.copilot-work\n\n    ${dim}# Uninstall GSD from Copilot globally${reset}\n    npx get-shit-done-cc --global --uninstall\n\n  ${yellow}Notes:${reset}\n    The --config-dir option is useful when you have multiple configurations.\n    It takes priority over the COPILOT_CONFIG_DIR environment variable.\n`);
  process.exit(0);
}

/**
 * Expand ~ to home directory (shell doesn't expand in env vars passed to node)
 */
function expandTilde(filePath) {
  if (filePath && filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

/**
 * Build a hook command path using forward slashes for cross-platform compatibility.
 * On Windows, $HOME is not expanded by cmd.exe/PowerShell, so we use the actual path.
 */
function buildHookCommand(configDir, hookName) {
  // Use forward slashes for Node.js compatibility on all platforms
  const hooksPath = configDir.replace(/\\/g, '/') + '/hooks/' + hookName;
  return `node "${hooksPath}"`;
}


/**
 * Read and parse settings.json, returning empty object if it doesn't exist
 */
function readSettings(settingsPath) {
  if (fs.existsSync(settingsPath)) {
    try {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (e) {
      return {};
    }
  }
  return {};
}

/**
 * Write settings.json with proper formatting
 */
function writeSettings(settingsPath, settings) {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
}

// Cache for attribution settings (populated once per runtime during install)
const attributionCache = new Map();

/**
 * Get commit attribution setting for a runtime
 * @param {string} runtime
 * @returns {null|undefined|string}
 */
function getCommitAttribution(runtime) {
  if (attributionCache.has(runtime)) {
    return attributionCache.get(runtime);
  }
  // Copilot has no attribution setting equivalent
  const result = undefined;
  attributionCache.set(runtime, result);
  return result;
}

/**
 * Process Co-Authored-By lines based on attribution setting
 * @param {string} content - File content to process
 * @param {null|undefined|string} attribution - null=remove, undefined=keep, string=replace
 * @returns {string} Processed content
 */
function processAttribution(content, attribution) {
  if (attribution === null) {
    // Remove Co-Authored-By lines and the preceding blank line
    return content.replace(/(\r?\n){2}Co-Authored-By:.*$/gim, '');
  }
  if (attribution === undefined) {
    return content;
  }
  // Replace with custom attribution (escape $ to prevent backreference injection)
  const safeAttribution = attribution.replace(/\$/g, '$$$$');
  return content.replace(/Co-Authored-By:.*$/gim, `Co-Authored-By: ${safeAttribution}`);
}

/**
 * Convert a Claude Code tool name to GitHub Copilot format.
 * - Applies explicit mapping from claudeToCopilotTools
 * - Handles mcp__context7__* prefix → io.github.upstash/context7/*
 * - Falls back to lowercase for unknown tools
 */
function convertCopilotToolName(claudeTool) {
  // mcp__context7__* wildcard → io.github.upstash/context7/*
  if (claudeTool.startsWith('mcp__context7__')) {
    return 'io.github.upstash/context7/' + claudeTool.slice('mcp__context7__'.length);
  }
  // Check explicit mapping
  if (claudeToCopilotTools[claudeTool]) {
    return claudeToCopilotTools[claudeTool];
  }
  // Default: lowercase
  return claudeTool.toLowerCase();
}

/**
 * Apply Copilot-specific content conversion — CONV-06 (paths) + CONV-07 (command names).
 * Path mappings depend on install mode:
 *   Global: ~/.claude/ → ~/.copilot/, ./.claude/ → ./.github/
 *   Local:  ~/.claude/ → ./.github/, ./.claude/ → ./.github/
 * Applied to ALL Copilot content (skills, agents, engine files).
 * @param {string} content - Source content to convert
 * @param {boolean} [isGlobal=false] - Whether this is a global install
 */
function convertClaudeToCopilotContent(content, isGlobal = false) {
  let c = content;
  // CONV-06: Path replacement — most specific first to avoid substring matches
  if (isGlobal) {
    c = c.replace(/\$HOME\/\.claude\//g, '$HOME/.copilot/');
    c = c.replace(/~\/\.claude\//g, '~/.copilot/');
  } else {
    c = c.replace(/\$HOME\/\.claude\//g, '.github/');
    c = c.replace(/~\/\.claude\//g, '.github/');
  }
  c = c.replace(/\.\/\.claude\//g, './.github/');
  c = c.replace(/\.claude\//g, '.github/');
  // CONV-07: Command name conversion (all gsd: references → gsd-)
  c = c.replace(/gsd:/g, 'gsd-');
  // Runtime-neutral agent name replacement (#766)
  c = neutralizeAgentReferences(c, 'copilot-instructions.md');
  return c;
}

/**
 * Convert a Claude command (.md) to a Copilot skill (SKILL.md).
 * Transforms frontmatter only — body passes through with CONV-06/07 applied.
 * Skills keep original tool names (no mapping) per CONTEXT.md decision.
 */
function convertClaudeCommandToCopilotSkill(content, skillName, isGlobal = false) {
  const converted = convertClaudeToCopilotContent(content, isGlobal);
  const { frontmatter, body } = extractFrontmatterAndBody(converted);
  if (!frontmatter) return converted;

  const description = extractFrontmatterField(frontmatter, 'description') || '';
  const argumentHint = extractFrontmatterField(frontmatter, 'argument-hint');
  const agent = extractFrontmatterField(frontmatter, 'agent');

  // CONV-02: Extract allowed-tools YAML multiline list → comma-separated string
  const toolsMatch = frontmatter.match(/^allowed-tools:\s*\n((?:\s+-\s+.+\n?)*)/m);
  let toolsLine = '';
  if (toolsMatch) {
    const tools = toolsMatch[1].match(/^\s+-\s+(.+)/gm);
    if (tools) {
      toolsLine = tools.map(t => t.replace(/^\s+-\s+/, '').trim()).join(', ');
    }
  }

  // Reconstruct frontmatter in Copilot format
  let fm = `---\nname: ${skillName}\ndescription: ${description}\n`;
  if (argumentHint) fm += `argument-hint: ${yamlQuote(argumentHint)}\n`;
  if (agent) fm += `agent: ${agent}\n`;
  if (toolsLine) fm += `allowed-tools: ${toolsLine}\n`;
  fm += '---';

  return `${fm}\n${body}`;
}

/**
 * Convert a Claude agent (.md) to a Copilot agent (.agent.md).
 * Applies tool mapping + deduplication, formats tools as JSON array.
 * CONV-04: JSON array format. CONV-05: Tool name mapping.
 */
function convertClaudeAgentToCopilotAgent(content, isGlobal = false) {
  const converted = convertClaudeToCopilotContent(content, isGlobal);
  const { frontmatter, body } = extractFrontmatterAndBody(converted);
  if (!frontmatter) return converted;

  const name = extractFrontmatterField(frontmatter, 'name') || 'unknown';
  const description = extractFrontmatterField(frontmatter, 'description') || '';
  const color = extractFrontmatterField(frontmatter, 'color');
  const toolsRaw = extractFrontmatterField(frontmatter, 'tools') || '';

  // CONV-04 + CONV-05: Map tools, deduplicate, format as JSON array
  const claudeTools = toolsRaw.split(',').map(t => t.trim()).filter(Boolean);
  const mappedTools = claudeTools.map(t => convertCopilotToolName(t));
  const uniqueTools = [...new Set(mappedTools)];
  const toolsArray = uniqueTools.length > 0
    ? "['" + uniqueTools.join("', '") + "']"
    : '[]';

  // Reconstruct frontmatter in Copilot format
  let fm = `---\nname: ${name}\ndescription: ${description}\ntools: ${toolsArray}\n`;
  if (color) fm += `color: ${color}\n`;
  fm += '---';

  return `${fm}\n${body}`;
}

function toSingleLine(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function yamlQuote(value) {
  return JSON.stringify(value);
}

function yamlIdentifier(value) {
  const text = String(value).trim();
  if (/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(text)) {
    return text;
  }
  return yamlQuote(text);
}

function extractFrontmatterAndBody(content) {
  if (!content.startsWith('---')) {
    return { frontmatter: null, body: content };
  }

  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return { frontmatter: null, body: content };
  }

  return {
    frontmatter: content.substring(3, endIndex).trim(),
    body: content.substring(endIndex + 3),
  };
}

function extractFrontmatterField(frontmatter, fieldName) {
  const regex = new RegExp(`^${fieldName}:\\s*(.+)$`, 'm');
  const match = frontmatter.match(regex);
  if (!match) return null;
  return match[1].trim().replace(/^['"]|['"]$/g, '');
}

/**
 * Runtime-neutral agent name and instruction file replacement.
 * Used by ALL non-Claude runtime converters to avoid Claude-specific
 * references in workflow prompts, agent definitions, and documentation.
 *
 * Replaces:
 * - Standalone "Claude" (agent name) → "the agent"
 *   Preserves: "Claude Code" (product), "Claude Opus/Sonnet/Haiku" (models),
 *   "claude-" (prefixes), "CLAUDE.md" (handled separately)
 * - "CLAUDE.md" → runtime-appropriate instruction file
 * - "Do NOT load full AGENTS.md" → removed (harmful for AGENTS.md runtimes)
 *
 * @param {string} content - File content to neutralize
 * @param {string} instructionFile - Runtime's instruction file ('AGENTS.md', 'GEMINI.md', etc.)
 * @returns {string} Content with runtime-neutral references
 */
function neutralizeAgentReferences(content, instructionFile) {
  let c = content;
  // Replace standalone "Claude" (the agent) but preserve product/model names.
  // Negative lookahead avoids: Claude Code, Claude Opus/Sonnet/Haiku, Claude native, Claude-based
  c = c.replace(/\bClaude(?! Code| Opus| Sonnet| Haiku| native| based|-)\b(?!\.md)/g, 'the agent');
  // Replace CLAUDE.md with runtime-appropriate instruction file
  if (instructionFile) {
    c = c.replace(/CLAUDE\.md/g, instructionFile);
  }
  // Remove instructions that conflict with AGENTS.md-based runtimes
  c = c.replace(/Do NOT load full `AGENTS\.md` files[^\n]*/g, '');
  return c;
}

/**
 * Merge GSD instructions into copilot-instructions.md.
 * Three cases: new file, existing with markers, existing without markers.
 * @param {string} filePath - Full path to copilot-instructions.md
 * @param {string} gsdContent - Template content (without markers)
 */
function mergeCopilotInstructions(filePath, gsdContent) {
  const gsdBlock = GSD_COPILOT_INSTRUCTIONS_MARKER + '\n' +
    gsdContent.trim() + '\n' +
    GSD_COPILOT_INSTRUCTIONS_CLOSE_MARKER;

  // Case 1: No file — create fresh
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, gsdBlock + '\n');
    return;
  }

  const existing = fs.readFileSync(filePath, 'utf8');
  const openIndex = existing.indexOf(GSD_COPILOT_INSTRUCTIONS_MARKER);
  const closeIndex = existing.indexOf(GSD_COPILOT_INSTRUCTIONS_CLOSE_MARKER);

  // Case 2: Has GSD markers — replace between markers
  if (openIndex !== -1 && closeIndex !== -1) {
    const before = existing.substring(0, openIndex).trimEnd();
    const after = existing.substring(closeIndex + GSD_COPILOT_INSTRUCTIONS_CLOSE_MARKER.length).trimStart();
    let newContent = '';
    if (before) newContent += before + '\n\n';
    newContent += gsdBlock;
    if (after) newContent += '\n\n' + after;
    newContent += '\n';
    fs.writeFileSync(filePath, newContent);
    return;
  }

  // Case 3: No markers — append at end
  const content = existing.trimEnd() + '\n\n' + gsdBlock + '\n';
  fs.writeFileSync(filePath, content);
}

/**
 * Strip GSD section from copilot-instructions.md content.
 * Returns cleaned content, or null if file should be deleted (was GSD-only).
 * @param {string} content - File content
 * @returns {string|null} - Cleaned content or null if empty
 */
function stripGsdFromCopilotInstructions(content) {
  const openIndex = content.indexOf(GSD_COPILOT_INSTRUCTIONS_MARKER);
  const closeIndex = content.indexOf(GSD_COPILOT_INSTRUCTIONS_CLOSE_MARKER);

  if (openIndex !== -1 && closeIndex !== -1) {
    const before = content.substring(0, openIndex).trimEnd();
    const after = content.substring(closeIndex + GSD_COPILOT_INSTRUCTIONS_CLOSE_MARKER.length).trimStart();
    const cleaned = (before + (before && after ? '\n\n' : '') + after).trim();
    if (!cleaned) return null;
    return cleaned + '\n';
  }

  // No markers found — nothing to strip
  return content;
}


/**
 * Copy Claude commands as Copilot skills — one folder per skill with SKILL.md.
 * Applies CONV-01 (structure), CONV-02 (allowed-tools), CONV-06 (paths), CONV-07 (command names).
 */
function copyCommandsAsCopilotSkills(srcDir, skillsDir, prefix, isGlobal = false) {
  if (!fs.existsSync(srcDir)) {
    return;
  }

  fs.mkdirSync(skillsDir, { recursive: true });

  // Remove previous GSD Copilot skills
  const existing = fs.readdirSync(skillsDir, { withFileTypes: true });
  for (const entry of existing) {
    if (entry.isDirectory() && entry.name.startsWith(`${prefix}-`)) {
      fs.rmSync(path.join(skillsDir, entry.name), { recursive: true });
    }
  }

  function recurse(currentSrcDir, currentPrefix) {
    const entries = fs.readdirSync(currentSrcDir, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(currentSrcDir, entry.name);
      if (entry.isDirectory()) {
        recurse(srcPath, `${currentPrefix}-${entry.name}`);
        continue;
      }

      if (!entry.name.endsWith('.md')) {
        continue;
      }

      const baseName = entry.name.replace('.md', '');
      const skillName = `${currentPrefix}-${baseName}`;
      const skillDir = path.join(skillsDir, skillName);
      fs.mkdirSync(skillDir, { recursive: true });

      let content = fs.readFileSync(srcPath, 'utf8');
      content = convertClaudeCommandToCopilotSkill(content, skillName, isGlobal);
      content = processAttribution(content, getCommitAttribution('copilot'));

      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content);
    }
  }

  recurse(srcDir, prefix);
}

/**
 * Recursively copy directory, replacing paths in .md files
 * Deletes existing destDir first to remove orphaned files from previous versions
 * @param {string} srcDir - Source directory
 * @param {string} destDir - Destination directory
 * @param {string} pathPrefix - Path prefix for file references
 * @param {string} runtime - Target runtime ('copilot')
 */
function copyWithPathReplacement(srcDir, destDir, pathPrefix, runtime, isCommand = false, isGlobal = false) {
  // Clean install: remove existing destination to prevent orphaned files
  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true });
  }
  fs.mkdirSync(destDir, { recursive: true });

  const entries = fs.readdirSync(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      copyWithPathReplacement(srcPath, destPath, pathPrefix, runtime, isCommand, isGlobal);
    } else if (entry.name.endsWith('.md')) {
      let content = fs.readFileSync(srcPath, 'utf8');
      content = processAttribution(content, getCommitAttribution(runtime));
      content = convertClaudeToCopilotContent(content, isGlobal);
      content = processAttribution(content, getCommitAttribution(runtime));
      fs.writeFileSync(destPath, content);
    } else if (entry.name.endsWith('.cjs') || entry.name.endsWith('.js')) {
      let content = fs.readFileSync(srcPath, 'utf8');
      content = convertClaudeToCopilotContent(content, isGlobal);
      fs.writeFileSync(destPath, content);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Clean up orphaned files from previous GSD versions
 */
function cleanupOrphanedFiles(configDir) {
  const orphanedFiles = [
    'hooks/gsd-notify.sh',  // Removed in v1.6.x
    'hooks/statusline.js',  // Renamed to gsd-statusline.js in v1.9.0
  ];

  for (const relPath of orphanedFiles) {
    const fullPath = path.join(configDir, relPath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      console.log(`  ${green}✓${reset} Removed orphaned ${relPath}`);
    }
  }
}

/**
 * Clean up orphaned hook registrations from settings.json
 */
function cleanupOrphanedHooks(settings) {
  const orphanedHookPatterns = [
    'gsd-notify.sh',  // Removed in v1.6.x
    'hooks/statusline.js',  // Renamed to gsd-statusline.js in v1.9.0
    'gsd-intel-index.js',  // Removed in v1.9.2
    'gsd-intel-session.js',  // Removed in v1.9.2
    'gsd-intel-prune.js',  // Removed in v1.9.2
  ];

  let cleanedHooks = false;

  // Check all hook event types (Stop, SessionStart, etc.)
  if (settings.hooks) {
    for (const eventType of Object.keys(settings.hooks)) {
      const hookEntries = settings.hooks[eventType];
      if (Array.isArray(hookEntries)) {
        // Filter out entries that contain orphaned hooks
        const filtered = hookEntries.filter(entry => {
          if (entry.hooks && Array.isArray(entry.hooks)) {
            // Check if any hook in this entry matches orphaned patterns
            const hasOrphaned = entry.hooks.some(h =>
              h.command && orphanedHookPatterns.some(pattern => h.command.includes(pattern))
            );
            if (hasOrphaned) {
              cleanedHooks = true;
              return false;  // Remove this entry
            }
          }
          return true;  // Keep this entry
        });
        settings.hooks[eventType] = filtered;
      }
    }
  }

  if (cleanedHooks) {
    console.log(`  ${green}✓${reset} Removed orphaned hook registrations`);
  }

  // Fix #330: Update statusLine if it points to old GSD statusline.js path
  // Only match the specific old GSD path pattern (hooks/statusline.js),
  // not third-party statusline scripts that happen to contain 'statusline.js'
  if (settings.statusLine && settings.statusLine.command &&
      /hooks[\/\\]statusline\.js/.test(settings.statusLine.command)) {
    settings.statusLine.command = settings.statusLine.command.replace(
      /hooks([\/\\])statusline\.js/,
      'hooks$1gsd-statusline.js'
    );
    console.log(`  ${green}✓${reset} Updated statusline path (hooks/statusline.js → hooks/gsd-statusline.js)`);
  }

  return settings;
}

/**
 * Validate hook field requirements to prevent silent settings.json rejection.
 *
 * Claude Code validates the entire settings file with a strict Zod schema.
 * If ANY hook has an invalid schema (e.g., type: "agent" missing "prompt"),
 * the ENTIRE settings.json is silently discarded — disabling all plugins,
 * env vars, and other configuration.
 *
 * This defensive check removes invalid hook entries and cleans up empty
 * event arrays to prevent this. It validates:
 *   - agent hooks require a "prompt" field
 *   - command hooks require a "command" field
 *   - entries must have a valid "hooks" array (non-array/missing is removed)
 *
 * @param {object} settings - The settings object (mutated in place)
 * @returns {object} The same settings object
 */
function validateHookFields(settings) {
  if (!settings.hooks || typeof settings.hooks !== 'object') return settings;

  let fixedHooks = false;
  const emptyKeys = [];

  for (const [eventType, hookEntries] of Object.entries(settings.hooks)) {
    if (!Array.isArray(hookEntries)) continue;

    // Pass 1: validate each entry, building a new array without mutation
    const validated = [];
    for (const entry of hookEntries) {
      // Entries without a hooks sub-array are structurally invalid — remove them
      if (!entry.hooks || !Array.isArray(entry.hooks)) {
        fixedHooks = true;
        continue;
      }

      // Filter invalid hooks within the entry
      const validHooks = entry.hooks.filter(h => {
        if (h.type === 'agent' && !h.prompt) {
          fixedHooks = true;
          return false;
        }
        if (h.type === 'command' && !h.command) {
          fixedHooks = true;
          return false;
        }
        return true;
      });

      // Drop entries whose hooks are now empty
      if (validHooks.length === 0) {
        fixedHooks = true;
        continue;
      }

      // Build a clean copy instead of mutating the original entry
      validated.push({ ...entry, hooks: validHooks });
    }

    settings.hooks[eventType] = validated;

    // Collect empty event arrays for removal (avoid delete during iteration)
    if (validated.length === 0) {
      emptyKeys.push(eventType);
      fixedHooks = true;
    }
  }

  // Pass 2: remove empty event arrays
  for (const key of emptyKeys) {
    delete settings.hooks[key];
  }

  if (fixedHooks) {
    console.log(`  ${green}✓${reset} Fixed invalid hook entries (prevents settings.json schema rejection)`);
  }

  return settings;
}

/**
 * Uninstall GSD from the specified directory for a specific runtime
 * Removes only GSD-specific files/directories, preserves user content
 * @param {boolean} isGlobal - Whether to uninstall from global or local
 * @param {string} runtime - Target runtime ('copilot')
 */
function uninstall(isGlobal, runtime = 'copilot') {
  const targetDir = isGlobal
    ? getGlobalDir('copilot', explicitConfigDir)
    : path.join(process.cwd(), '.github');

  const locationLabel = isGlobal
    ? targetDir.replace(os.homedir(), '~')
    : targetDir.replace(process.cwd(), '.');

  console.log(`  Uninstalling GSD from ${cyan}Copilot${reset} at ${cyan}${locationLabel}${reset}\n`);

  if (!fs.existsSync(targetDir)) {
    console.log(`  ${yellow}⚠${reset} Directory does not exist: ${locationLabel}`);
    console.log(`  Nothing to uninstall.\n`);
    return;
  }

  let removedCount = 0;

  // Remove skills/gsd-*/ directories
  const skillsDir = path.join(targetDir, 'skills');
  if (fs.existsSync(skillsDir)) {
    let skillCount = 0;
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('gsd-')) {
        fs.rmSync(path.join(skillsDir, entry.name), { recursive: true });
        skillCount++;
      }
    }
    if (skillCount > 0) {
      removedCount++;
      console.log(`  ${green}✓${reset} Removed ${skillCount} Copilot skills`);
    }
  }

  // Clean GSD section from copilot-instructions.md
  const instructionsPath = path.join(targetDir, 'copilot-instructions.md');
  if (fs.existsSync(instructionsPath)) {
    const content = fs.readFileSync(instructionsPath, 'utf8');
    const cleaned = stripGsdFromCopilotInstructions(content);
    if (cleaned === null) {
      fs.unlinkSync(instructionsPath);
      removedCount++;
      console.log(`  ${green}✓${reset} Removed copilot-instructions.md (was GSD-only)`);
    } else if (cleaned !== content) {
      fs.writeFileSync(instructionsPath, cleaned);
      removedCount++;
      console.log(`  ${green}✓${reset} Cleaned GSD section from copilot-instructions.md`);
    }
  }

  // Remove get-shit-done directory
  const gsdDir = path.join(targetDir, 'get-shit-done');
  if (fs.existsSync(gsdDir)) {
    fs.rmSync(gsdDir, { recursive: true });
    removedCount++;
    console.log(`  ${green}✓${reset} Removed get-shit-done/`);
  }

  // Remove GSD agents (gsd-*.agent.md files)
  const agentsDir = path.join(targetDir, 'agents');
  if (fs.existsSync(agentsDir)) {
    const files = fs.readdirSync(agentsDir);
    let agentCount = 0;
    for (const file of files) {
      if (file.startsWith('gsd-') && file.endsWith('.md')) {
        fs.unlinkSync(path.join(agentsDir, file));
        agentCount++;
      }
    }
    if (agentCount > 0) {
      removedCount++;
      console.log(`  ${green}✓${reset} Removed ${agentCount} GSD agents`);
    }
  }

  if (removedCount === 0) {
    console.log(`  ${yellow}⚠${reset} No GSD files found to remove.`);
  }

  console.log(`
  ${green}Done!${reset} GSD has been uninstalled from Copilot.
  Your other files and settings have been preserved.
`);
}

/**
 * Verify a directory exists and contains files
 */
function verifyInstalled(dirPath, description) {
  if (!fs.existsSync(dirPath)) {
    console.error(`  ${yellow}✗${reset} Failed to install ${description}: directory not created`);
    return false;
  }
  try {
    const entries = fs.readdirSync(dirPath);
    if (entries.length === 0) {
      console.error(`  ${yellow}✗${reset} Failed to install ${description}: directory is empty`);
      return false;
    }
  } catch (e) {
    console.error(`  ${yellow}✗${reset} Failed to install ${description}: ${e.message}`);
    return false;
  }
  return true;
}

/**
 * Verify a file exists
 */
function verifyFileInstalled(filePath, description) {
  if (!fs.existsSync(filePath)) {
    console.error(`  ${yellow}✗${reset} Failed to install ${description}: file not created`);
    return false;
  }
  return true;
}

// ──────────────────────────────────────────────────────
// Local Patch Persistence
// ──────────────────────────────────────────────────────

const PATCHES_DIR_NAME = 'gsd-local-patches';
const MANIFEST_NAME = 'gsd-file-manifest.json';

/**
 * Compute SHA256 hash of file contents
 */
function fileHash(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Recursively collect all files in dir with their hashes
 */
function generateManifest(dir, baseDir) {
  if (!baseDir) baseDir = dir;
  const manifest = {};
  if (!fs.existsSync(dir)) return manifest;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      Object.assign(manifest, generateManifest(fullPath, baseDir));
    } else {
      manifest[relPath] = fileHash(fullPath);
    }
  }
  return manifest;
}

/**
 * List Copilot skill directory names under skillsDir that start with prefix
 */
function listCopilotSkillNames(skillsDir, prefix = 'gsd-') {
  if (!fs.existsSync(skillsDir)) return [];
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory() && entry.name.startsWith(prefix))
    .filter(entry => fs.existsSync(path.join(skillsDir, entry.name, 'SKILL.md')))
    .map(entry => entry.name)
    .sort();
}

/**
 * Write file manifest after installation for future modification detection
 */
function writeManifest(configDir, runtime = 'copilot') {
  const gsdDir = path.join(configDir, 'get-shit-done');
  const skillsDir = path.join(configDir, 'skills');
  const agentsDir = path.join(configDir, 'agents');
  const manifest = { version: pkg.version, timestamp: new Date().toISOString(), files: {} };

  const gsdHashes = generateManifest(gsdDir);
  for (const [rel, hash] of Object.entries(gsdHashes)) {
    manifest.files['get-shit-done/' + rel] = hash;
  }

  if (fs.existsSync(skillsDir)) {
    for (const skillName of listCopilotSkillNames(skillsDir)) {
      const skillRoot = path.join(skillsDir, skillName);
      const skillHashes = generateManifest(skillRoot);
      for (const [rel, hash] of Object.entries(skillHashes)) {
        manifest.files[`skills/${skillName}/${rel}`] = hash;
      }
    }
  }

  if (fs.existsSync(agentsDir)) {
    for (const file of fs.readdirSync(agentsDir)) {
      if (file.startsWith('gsd-') && file.endsWith('.md')) {
        manifest.files['agents/' + file] = fileHash(path.join(agentsDir, file));
      }
    }
  }

  fs.writeFileSync(path.join(configDir, MANIFEST_NAME), JSON.stringify(manifest, null, 2));
  return manifest;
}

/**
 * Detect user-modified GSD files by comparing against install manifest.
 * Backs up modified files to gsd-local-patches/ for reapply after update.
 */
function saveLocalPatches(configDir) {
  const manifestPath = path.join(configDir, MANIFEST_NAME);
  if (!fs.existsSync(manifestPath)) return [];

  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { return []; }

  const patchesDir = path.join(configDir, PATCHES_DIR_NAME);
  const modified = [];

  for (const [relPath, originalHash] of Object.entries(manifest.files || {})) {
    const fullPath = path.join(configDir, relPath);
    if (!fs.existsSync(fullPath)) continue;
    const currentHash = fileHash(fullPath);
    if (currentHash !== originalHash) {
      const backupPath = path.join(patchesDir, relPath);
      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      fs.copyFileSync(fullPath, backupPath);
      modified.push(relPath);
    }
  }

  if (modified.length > 0) {
    const meta = {
      backed_up_at: new Date().toISOString(),
      from_version: manifest.version,
      files: modified
    };
    fs.writeFileSync(path.join(patchesDir, 'backup-meta.json'), JSON.stringify(meta, null, 2));
    console.log('  ' + yellow + 'i' + reset + '  Found ' + modified.length + ' locally modified GSD file(s) — backed up to ' + PATCHES_DIR_NAME + '/');
    for (const f of modified) {
      console.log('     ' + dim + f + reset);
    }
  }
  return modified;
}

/**
 * After install, report backed-up patches for user to reapply.
 */
function reportLocalPatches(configDir, runtime = 'copilot') {
  const patchesDir = path.join(configDir, PATCHES_DIR_NAME);
  const metaPath = path.join(patchesDir, 'backup-meta.json');
  if (!fs.existsSync(metaPath)) return [];

  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch { return []; }

  if (meta.files && meta.files.length > 0) {
    const reapplyCommand = '/gsd-reapply-patches';
    console.log('');
    console.log('  ' + yellow + 'Local patches detected' + reset + ' (from v' + meta.from_version + '):');
    for (const f of meta.files) {
      console.log('     ' + cyan + f + reset);
    }
    console.log('');
    console.log('  Your modifications are saved in ' + cyan + PATCHES_DIR_NAME + '/' + reset);
    console.log('  Run ' + cyan + reapplyCommand + reset + ' to merge them into the new version.');
    console.log('  Or manually compare and merge the files.');
    console.log('');
  }
  return meta.files || [];
}

function install(isGlobal, runtime = 'copilot') {
  const dirName = '.github';
  const src = path.join(__dirname, '..');

  const targetDir = isGlobal
    ? getGlobalDir('copilot', explicitConfigDir)
    : path.join(process.cwd(), dirName);

  const locationLabel = isGlobal
    ? targetDir.replace(os.homedir(), '~')
    : targetDir.replace(process.cwd(), '.');

  const resolvedTarget = path.resolve(targetDir).replace(/\\/g, '/');
  const homeDir = os.homedir().replace(/\\/g, '/');
  const pathPrefix = isGlobal && resolvedTarget.startsWith(homeDir)
    ? '$HOME' + resolvedTarget.slice(homeDir.length) + '/'
    : `${resolvedTarget}/`;

  console.log(`  Installing for ${cyan}Copilot${reset} to ${cyan}${locationLabel}${reset}\n`);

  const failures = [];

  saveLocalPatches(targetDir);
  cleanupOrphanedFiles(targetDir);

  // Copilot: skills/ directory
  const skillsDir = path.join(targetDir, 'skills');
  const gsdSrc = path.join(src, 'commands', 'gsd');
  copyCommandsAsCopilotSkills(gsdSrc, skillsDir, 'gsd', isGlobal);
  if (fs.existsSync(skillsDir)) {
    const count = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && e.name.startsWith('gsd-')).length;
    if (count > 0) {
      console.log(`  ${green}✓${reset} Installed ${count} skills to skills/`);
    } else {
      failures.push('skills/gsd-*');
    }
  } else {
    failures.push('skills/gsd-*');
  }

  // Copy get-shit-done skill with path replacement
  const skillSrc = path.join(src, 'get-shit-done');
  const skillDest = path.join(targetDir, 'get-shit-done');
  copyWithPathReplacement(skillSrc, skillDest, pathPrefix, 'copilot', false, isGlobal);
  if (verifyInstalled(skillDest, 'get-shit-done')) {
    console.log(`  ${green}✓${reset} Installed get-shit-done`);
  } else {
    failures.push('get-shit-done');
  }

  // Copy agents to agents directory
  const agentsSrc = path.join(src, 'agents');
  if (fs.existsSync(agentsSrc)) {
    const agentsDest = path.join(targetDir, 'agents');
    fs.mkdirSync(agentsDest, { recursive: true });

    // Remove old GSD agents (gsd-*.md) before copying new ones
    if (fs.existsSync(agentsDest)) {
      for (const file of fs.readdirSync(agentsDest)) {
        if (file.startsWith('gsd-') && file.endsWith('.md')) {
          fs.unlinkSync(path.join(agentsDest, file));
        }
      }
    }

    const agentEntries = fs.readdirSync(agentsSrc, { withFileTypes: true });
    for (const entry of agentEntries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        let content = fs.readFileSync(path.join(agentsSrc, entry.name), 'utf8');
        content = processAttribution(content, getCommitAttribution('copilot'));
        content = convertClaudeAgentToCopilotAgent(content, isGlobal);
        const destName = entry.name.replace('.md', '.agent.md');
        fs.writeFileSync(path.join(agentsDest, destName), content);
      }
    }
    if (verifyInstalled(agentsDest, 'agents')) {
      console.log(`  ${green}✓${reset} Installed agents`);
    } else {
      failures.push('agents');
    }
  }

  // Copy CHANGELOG.md
  const changelogSrc = path.join(src, 'CHANGELOG.md');
  const changelogDest = path.join(targetDir, 'get-shit-done', 'CHANGELOG.md');
  if (fs.existsSync(changelogSrc)) {
    fs.copyFileSync(changelogSrc, changelogDest);
    if (verifyFileInstalled(changelogDest, 'CHANGELOG.md')) {
      console.log(`  ${green}✓${reset} Installed CHANGELOG.md`);
    } else {
      failures.push('CHANGELOG.md');
    }
  }

  // Write VERSION file
  const versionDest = path.join(targetDir, 'get-shit-done', 'VERSION');
  fs.writeFileSync(versionDest, pkg.version);
  if (verifyFileInstalled(versionDest, 'VERSION')) {
    console.log(`  ${green}✓${reset} Wrote VERSION (${pkg.version})`);
  } else {
    failures.push('VERSION');
  }

  // Clear stale update cache
  const updateCacheFile = path.join(path.dirname(targetDir), 'cache', 'gsd-update-check.json');
  try { fs.unlinkSync(updateCacheFile); } catch (e) { /* cache may not exist yet */ }

  if (failures.length > 0) {
    console.error(`\n  ${yellow}Installation incomplete!${reset} Failed: ${failures.join(', ')}`);
    process.exit(1);
  }

  writeManifest(targetDir, 'copilot');
  console.log(`  ${green}✓${reset} Wrote file manifest (${MANIFEST_NAME})`);

  reportLocalPatches(targetDir, 'copilot');

  // Verify no leaked .claude paths
  const leakedPaths = [];
  function scanForLeakedPaths(dir) {
    if (!fs.existsSync(dir)) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'EPERM' || err.code === 'EACCES') {
        return;
      }
      throw err;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanForLeakedPaths(fullPath);
      } else if ((entry.name.endsWith('.md') || entry.name.endsWith('.toml')) && entry.name !== 'CHANGELOG.md') {
        let content;
        try {
          content = fs.readFileSync(fullPath, 'utf8');
        } catch (err) {
          if (err.code === 'EPERM' || err.code === 'EACCES') {
            continue;
          }
          throw err;
        }
        const matches = content.match(/(?:~|\$HOME)\/\.claude\b/g);
        if (matches) {
          leakedPaths.push({ file: fullPath.replace(targetDir + '/', ''), count: matches.length });
        }
      }
    }
  }
  scanForLeakedPaths(targetDir);
  if (leakedPaths.length > 0) {
    const totalLeaks = leakedPaths.reduce((sum, l) => sum + l.count, 0);
    console.warn(`\n  ${yellow}⚠${reset}  Found ${totalLeaks} unreplaced .claude path reference(s) in ${leakedPaths.length} file(s):`);
    for (const leak of leakedPaths.slice(0, 5)) {
      console.warn(`     ${dim}${leak.file}${reset} (${leak.count})`);
    }
    if (leakedPaths.length > 5) {
      console.warn(`     ${dim}... and ${leakedPaths.length - 5} more file(s)${reset}`);
    }
    console.warn(`  ${dim}These paths may not resolve correctly for Copilot.${reset}`);
  }

  // Generate copilot-instructions.md
  const templatePath = path.join(targetDir, 'get-shit-done', 'templates', 'copilot-instructions.md');
  const instructionsPath = path.join(targetDir, 'copilot-instructions.md');
  if (fs.existsSync(templatePath)) {
    const template = fs.readFileSync(templatePath, 'utf8');
    mergeCopilotInstructions(instructionsPath, template);
    console.log(`  ${green}✓${reset} Generated copilot-instructions.md`);
  }

  // Set resolve_model_ids: "omit" in ~/.gsd/defaults.json
  const gsdDefaultsDir = path.join(os.homedir(), '.gsd');
  const defaultsPath = path.join(gsdDefaultsDir, 'defaults.json');
  try {
    fs.mkdirSync(gsdDefaultsDir, { recursive: true });
    let defaults = {};
    try { defaults = JSON.parse(fs.readFileSync(defaultsPath, 'utf8')); } catch { /* new file */ }
    if (defaults.resolve_model_ids !== 'omit') {
      defaults.resolve_model_ids = 'omit';
      fs.writeFileSync(defaultsPath, JSON.stringify(defaults, null, 2) + '\n');
      console.log(`  ${green}✓${reset} Set resolve_model_ids: "omit" in ~/.gsd/defaults.json`);
    }
  } catch (e) {
    console.log(`  ${yellow}⚠${reset} Could not write ~/.gsd/defaults.json: ${e.message}`);
  }

  return { settingsPath: null, settings: null, statuslineCommand: null, runtime: 'copilot' };
}

/**
 * Print completion message
 */
function finishInstall(settingsPath, settings, statuslineCommand, shouldInstallStatusline, runtime = 'copilot', isGlobal = true) {
  console.log(`
  ${green}Done!${reset} Open a blank directory in Copilot and run ${cyan}/gsd-new-project${reset}.

  ${cyan}Join the community:${reset} https://discord.gg/gsd
`);
}

/**
 * Install the GSD SDK globally via npm.
 * @returns {boolean} true if install succeeded
 */
function installSdk() {
  const sdkVersion = pkg.version;
  const sdkPkg = `@gsd-build/sdk@${sdkVersion}`;
  console.log(`\n  ${cyan}Installing GSD SDK...${reset}`);
  console.log(`  ${dim}npm install -g ${sdkPkg}${reset}\n`);
  try {
    require('child_process').execSync(`npm install -g ${sdkPkg}`, { stdio: 'inherit' });
    console.log(`\n  ${green}✓${reset} GSD SDK installed (${cyan}gsd-sdk${reset} command available)`);
    return true;
  } catch (e) {
    console.log(`\n  ${yellow}⚠${reset} SDK install failed: ${e.message}`);
    console.log(`  ${dim}You can install it manually: npm install -g ${sdkPkg}${reset}`);
    return false;
  }
}

/**
 * Prompt the user to optionally install the GSD SDK.
 * Called after runtime installation completes.
 * @param {Function} callback - called with true/false
 */
function promptSdk(callback) {
  if (!process.stdin.isTTY) {
    callback(false);
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  let answered = false;

  rl.on('close', () => {
    if (!answered) {
      answered = true;
      callback(false);
    }
  });

  console.log(`
  ${yellow}Also install the GSD SDK?${reset}

  The SDK provides a standalone CLI for autonomous execution:
    ${dim}gsd-sdk init @prd.md${reset}    Bootstrap a project from a PRD
    ${dim}gsd-sdk auto${reset}            Run full autonomous lifecycle
    ${dim}gsd-sdk run "prompt"${reset}    Execute a milestone from text

  ${cyan}1${reset}) No
  ${cyan}2${reset}) Yes ${dim}(runs: npm install -g @gsd-build/sdk)${reset}
`);

  rl.question(`  Choice ${dim}[1]${reset}: `, (answer) => {
    answered = true;
    rl.close();
    const choice = answer.trim() || '1';
    callback(choice === '2');
  });
}

/**
 * Prompt for runtime selection — only copilot is supported, skip selection
 */
function promptRuntime(callback) {
  // Only copilot is supported — skip runtime selection
  callback(['copilot']);
}

/**
 * Prompt for install location
 */
function promptLocation(runtimes) {
  if (!process.stdin.isTTY) {
    console.log(`  ${yellow}Non-interactive terminal detected, defaulting to global install${reset}\n`);
    installAllRuntimes(runtimes, true, false);
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  let answered = false;

  rl.on('close', () => {
    if (!answered) {
      answered = true;
      console.log(`\n  ${yellow}Installation cancelled${reset}\n`);
      process.exit(0);
    }
  });

  const pathExamples = runtimes.map(r => {
    const globalPath = getGlobalDir(r, explicitConfigDir);
    return globalPath.replace(os.homedir(), '~');
  }).join(', ');

  const localExamples = runtimes.map(r => `./${getDirName(r)}`).join(', ');

  console.log(`  ${yellow}Where would you like to install?${reset}\n\n  ${cyan}1${reset}) Global ${dim}(${pathExamples})${reset} - available in all projects
  ${cyan}2${reset}) Local  ${dim}(${localExamples})${reset} - this project only
`);

  rl.question(`  Choice ${dim}[1]${reset}: `, (answer) => {
    answered = true;
    rl.close();
    const choice = answer.trim() || '1';
    const isGlobal = choice !== '2';
    installAllRuntimes(runtimes, isGlobal, true);
  });
}

/**
 * Install GSD for all selected runtimes
 */
function installAllRuntimes(runtimes, isGlobal, isInteractive) {
  const result = install(isGlobal, 'copilot');

  const finalize = () => {
    const printSummary = () => {
      finishInstall(
        result.settingsPath,
        result.settings,
        result.statuslineCommand,
        false,
        'copilot',
        isGlobal
      );
    };

    if (hasSdk) {
      installSdk();
      printSummary();
    } else if (isInteractive) {
      promptSdk((wantsSdk) => {
        if (wantsSdk) installSdk();
        printSummary();
      });
    } else {
      printSummary();
    }
  };

  finalize();
}

// Test-only exports — skip main logic when loaded as a module for testing
if (process.env.GSD_TEST_MODE) {
  module.exports = {
    yamlIdentifier,
    install,
    getDirName,
    getGlobalDir,
    getConfigDirFromHome,
    claudeToCopilotTools,
    convertCopilotToolName,
    convertClaudeToCopilotContent,
    convertClaudeCommandToCopilotSkill,
    convertClaudeAgentToCopilotAgent,
    copyCommandsAsCopilotSkills,
    GSD_COPILOT_INSTRUCTIONS_MARKER,
    GSD_COPILOT_INSTRUCTIONS_CLOSE_MARKER,
    mergeCopilotInstructions,
    stripGsdFromCopilotInstructions,
    writeManifest,
    reportLocalPatches,
    validateHookFields,
    installSdk,
    promptSdk,
    neutralizeAgentReferences,
  };
} else {

// Main logic
if (hasGlobal && hasLocal) {
  console.error(`  ${yellow}Cannot specify both --global and --local${reset}`);
  process.exit(1);
} else if (explicitConfigDir && hasLocal) {
  console.error(`  ${yellow}Cannot use --config-dir with --local${reset}`);
  process.exit(1);
} else if (hasUninstall) {
  if (!hasGlobal && !hasLocal) {
    console.error(`  ${yellow}--uninstall requires --global or --local${reset}`);
    process.exit(1);
  }
  uninstall(hasGlobal, 'copilot');
} else if (hasGlobal || hasLocal || hasCopilot) {
  installAllRuntimes(['copilot'], hasGlobal, false);
} else {
  // Interactive
  if (!process.stdin.isTTY) {
    console.log(`  ${yellow}Non-interactive terminal detected, defaulting to Copilot global install${reset}\n`);
    installAllRuntimes(['copilot'], true, false);
  } else {
    promptRuntime((runtimes) => {
      promptLocation(runtimes);
    });
  }
}

} // end of else block for GSD_TEST_MODE
