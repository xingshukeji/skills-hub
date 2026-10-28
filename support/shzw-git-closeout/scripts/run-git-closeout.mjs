import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

class CloseoutError extends Error {
  constructor(code, message, details = {}, exitCode = 2) {
    super(message);
    this.code = code;
    this.details = details;
    this.exitCode = exitCode;
  }
}

function parseArgs(argv) {
  const options = {
    mode: "commit-push",
    repo: ".",
    remote: "origin",
    branch: "main",
    paths: [],
    allowLinkedWorktree: false,
    includeStagedOwned: false,
    waitSeconds: 15,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--allow-linked-worktree") {
      options.allowLinkedWorktree = true;
      continue;
    }
    if (key === "--include-staged-owned") {
      options.includeStagedOwned = true;
      continue;
    }

    const value = argv[index + 1];
    if (!value) {
      throw new CloseoutError("invalid_arguments", `Missing value for ${key}.`, {}, 1);
    }
    index += 1;

    switch (key) {
      case "--mode":
        options.mode = value;
        break;
      case "--repo":
        options.repo = value;
        break;
      case "--remote":
        options.remote = value;
        break;
      case "--branch":
        options.branch = value;
        break;
      case "--message":
        options.message = value;
        break;
      case "--verification":
        options.verification = value;
        break;
      case "--commit":
        options.commit = value;
        break;
      case "--expected-tree":
        options.expectedTree = value;
        break;
      case "--wait-seconds":
        options.waitSeconds = Number(value);
        break;
      case "--path":
        options.paths.push(value);
        break;
      default:
        throw new CloseoutError("invalid_arguments", `Unknown argument: ${key}.`, {}, 1);
    }
  }

  if (!new Set(["snapshot", "check", "commit-push", "push-commit"]).has(options.mode)) {
    throw new CloseoutError("invalid_mode", "--mode must be snapshot, check, commit-push, or push-commit.", {}, 1);
  }
  if (options.mode !== "snapshot" && !options.verification?.trim()) {
    throw new CloseoutError("verification_required", "Non-empty --verification evidence is required.");
  }
  if (options.mode === "commit-push" && !options.message?.trim()) {
    throw new CloseoutError("message_required", "A non-empty --message is required for commit-push.");
  }
  if (options.mode === "push-commit" && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(options.commit || "")) {
    throw new CloseoutError("commit_required", "push-commit requires the full immutable commit SHA.", {}, 1);
  }
  if (options.mode !== "push-commit" && options.commit) {
    throw new CloseoutError("invalid_arguments", "--commit is only valid with push-commit.", {}, 1);
  }
  if (options.expectedTree && (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(options.expectedTree) || !["commit-push", "push-commit"].includes(options.mode))) {
    throw new CloseoutError("invalid_arguments", "--expected-tree requires a full tree SHA and a commit or push mode.", {}, 1);
  }
  if (!Number.isInteger(options.waitSeconds) || options.waitSeconds < 0 || options.waitSeconds > 60) {
    throw new CloseoutError("invalid_arguments", "--wait-seconds must be an integer from 0 to 60.", {}, 1);
  }
  if (options.paths.length === 0) {
    throw new CloseoutError("paths_required", "At least one explicit --path is required.");
  }
  if (!options.remote.trim() || !options.branch.trim()) {
    throw new CloseoutError("invalid_target", "Remote and branch must be non-empty.", {}, 1);
  }
  if (options.remote.startsWith("-") || options.branch.startsWith("-")) {
    throw new CloseoutError("invalid_target", "Remote and branch cannot start with a dash.", {}, 1);
  }

  return options;
}

function sanitizeGitOutput(value) {
  return value
    .replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, "$1[redacted]@")
    .replace(/([?&](?:access_token|api_key|key|password|sig|signature|token)=)[^&\s]+/gi, "$1[redacted]")
    .slice(0, 2000);
}

function runGit(repo, args, { allowFailure = false, indexFile, extraEnv = {}, literalPaths = true } = {}) {
  const env = { ...process.env, ...extraEnv };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_GLOB_PATHSPECS", "GIT_NOGLOB_PATHSPECS", "GIT_ICASE_PATHSPECS"]) {
    delete env[key];
  }
  if (literalPaths) env.GIT_LITERAL_PATHSPECS = "1";
  else delete env.GIT_LITERAL_PATHSPECS;
  if (indexFile) env.GIT_INDEX_FILE = indexFile;
  const result = spawnSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    env,
  });

  if (result.error) {
    throw new CloseoutError("git_unavailable", result.error.message, {}, 1);
  }
  if (result.status !== 0 && !allowFailure) {
    throw new CloseoutError("git_command_failed", `git ${args[0]} failed.`, {
      command: ["git", ...args],
      stderr: sanitizeGitOutput(result.stderr.trim()),
      stdout: sanitizeGitOutput(result.stdout.trim()),
    });
  }
  return result;
}

function gitText(repo, args) {
  return runGit(repo, args).stdout.trim();
}

function splitNull(value) {
  return value.split("\0").filter(Boolean);
}

function resolveGitPath(repo, value) {
  return path.resolve(repo, value.trim());
}

function normalizeOwnedPath(repo, value, { allowMissing = false } = {}) {
  if (!value?.trim() || path.isAbsolute(value)) {
    throw new CloseoutError("unsafe_path", "Owned paths must be non-empty repository-relative file paths.", { path: value });
  }

  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  const resolved = path.resolve(repo, normalized);
  const relative = path.relative(repo, resolved).replaceAll("\\", "/");
  if (!relative || relative === "." || relative.startsWith("../") || path.isAbsolute(relative)) {
    throw new CloseoutError("unsafe_path", "Owned path escapes the repository or names the repository root.", { path: value });
  }

  const lower = `/${relative.toLowerCase()}`;
  const base = path.posix.basename(lower);
  const blockedSegments = ["/node_modules/", "/dist/", "/bin/", "/obj/", "/.venv/", "/target/", "/.git/"];
  const blockedNames = new Set([".env", "id_rsa", "id_ed25519"]);
  const blockedExtensions = [".log", ".pem", ".key", ".pfx", ".p12"];
  if (
    blockedSegments.some((segment) => lower.includes(segment)) ||
    blockedNames.has(base) ||
    base.startsWith(".env.") ||
    blockedExtensions.some((extension) => base.endsWith(extension))
  ) {
    throw new CloseoutError("unsafe_path", "Owned path matches a blocked secret or generated-output class.", { path: relative });
  }

  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    throw new CloseoutError("directory_path_rejected", "Pass changed files individually; directories are not accepted.", { path: relative });
  }

  let tracked = splitNull(runGit(repo, ["ls-files", "-z", "--", relative]).stdout).includes(relative);
  if (!tracked && hasLocalHead(repo)) {
    tracked = splitNull(runGit(repo, ["ls-tree", "-r", "--name-only", "-z", "HEAD", "--", relative]).stdout).includes(relative);
  }
  if (!allowMissing && !fs.existsSync(resolved) && !tracked) {
    throw new CloseoutError("path_not_found", "Owned path is neither an existing file nor a tracked deletion.", { path: relative });
  }
  if (!allowMissing && !tracked) {
    // check-ignore accepts literal path names, but rejects Git's literal pathspec magic.
    const ignored = runGit(repo, ["check-ignore", "-q", "--", relative], { allowFailure: true, literalPaths: false });
    if (ignored.status === 0) {
      throw new CloseoutError("ignored_path", "The selected untracked file is ignored and cannot be delivered by this closeout.", { path: relative });
    }
    if (ignored.status !== 1) {
      throw new CloseoutError("ignore_state_unreadable", "Git could not determine whether the selected path is ignored.", {
        path: relative, stderr: sanitizeGitOutput(ignored.stderr.trim()),
      });
    }
  }
  return relative;
}

function assertCheckout(repo, options) {
  const prefix = gitText(repo, ["rev-parse", "--show-prefix"]);
  if (prefix) {
    throw new CloseoutError("repo_not_top_level", "--repo must name the current Git top-level directory.", { prefix });
  }

  const remotes = gitText(repo, ["remote"]).split(/\r?\n/).filter(Boolean);
  if (!remotes.includes(options.remote)) {
    throw new CloseoutError("remote_not_found", `Remote ${options.remote} does not exist.`, { remotes });
  }
  const branchCheck = runGit(repo, ["check-ref-format", "--branch", options.branch], { allowFailure: true });
  if (branchCheck.status !== 0) {
    throw new CloseoutError("invalid_target", `Branch ${options.branch} is not a valid branch name.`, {}, 1);
  }

  const branch = gitText(repo, ["branch", "--show-current"]);
  if (branch !== options.branch) {
    throw new CloseoutError("branch_not_allowed", `Current branch is ${branch || "detached HEAD"}; expected ${options.branch}.`, {
      currentBranch: branch,
      expectedBranch: options.branch,
    });
  }

  const gitDir = resolveGitPath(repo, gitText(repo, ["rev-parse", "--git-dir"]));
  const commonDir = resolveGitPath(repo, gitText(repo, ["rev-parse", "--git-common-dir"]));
  if (!options.allowLinkedWorktree && path.normalize(gitDir) !== path.normalize(commonDir)) {
    throw new CloseoutError("linked_worktree_not_allowed", "The current checkout is a linked worktree.");
  }
}

function overlappingStaged(repo, ownedPaths) {
  const staged = splitNull(runGit(repo, ["diff", "--cached", "--no-renames", "--name-only", "-z"]).stdout);
  return staged.filter((file) => ownedPaths.includes(file));
}

function assertNoOverlappingStaged(repo, ownedPaths, includeStagedOwned) {
  const overlapping = overlappingStaged(repo, ownedPaths);
  if (overlapping.length > 0 && !includeStagedOwned) {
    throw new CloseoutError("overlapping_staged_changes", "A selected path already has staged content; its ownership cannot be separated by a whole-file commit.", { overlapping });
  }
}

function assertNoOperationInProgress(repo) {
  for (const name of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply", "sequencer"]) {
    const gitPath = resolveGitPath(repo, gitText(repo, ["rev-parse", "--git-path", name]));
    if (fs.existsSync(gitPath)) {
      throw new CloseoutError("operation_in_progress", "Another Git operation is in progress; leave it untouched.", { operation: name });
    }
  }
}

function selectedChanges(repo, ownedPaths, includeStagedOwned) {
  const diff = ["diff", "--no-renames", "--name-only", "-z"];
  if (includeStagedOwned && hasLocalHead(repo)) diff.push("HEAD");
  const unstaged = splitNull(runGit(repo, [...diff, "--", ...ownedPaths]).stdout);
  const staged = includeStagedOwned && !hasLocalHead(repo) ? overlappingStaged(repo, ownedPaths) : [];
  const untracked = splitNull(runGit(repo, ["ls-files", "--others", "--exclude-standard", "-z", "--", ...ownedPaths]).stdout);
  return [...new Set([...unstaged, ...staged, ...untracked])].filter((file) => ownedPaths.includes(file)).sort();
}

function hasLocalHead(repo) {
  return runGit(repo, ["rev-parse", "--verify", "HEAD"], { allowFailure: true }).status === 0;
}

function remoteHeadRecords(repo, remote) {
  const output = gitText(repo, ["ls-remote", "--heads", remote]);
  return output.split(/\r?\n/).filter(Boolean).map((line) => {
    const [sha, ref] = line.split(/\s+/);
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(sha || "") || !ref?.startsWith("refs/heads/")) {
      throw new CloseoutError("remote_state_unreadable", "Git returned an invalid remote branch listing.");
    }
    return { sha, ref };
  });
}

function remoteHeads(repo, remote) {
  return remoteHeadRecords(repo, remote).map(({ ref }) => ref);
}

function syncCounts(repo, remote, branch) {
  runGit(repo, ["fetch", "--no-tags", remote, branch]);
  const output = gitText(repo, ["rev-list", "--left-right", "--count", `HEAD...${remote}/${branch}`]);
  const [ahead, behind] = output.split(/\s+/).map(Number);
  if (!Number.isInteger(ahead) || !Number.isInteger(behind)) {
    throw new CloseoutError("sync_state_unreadable", "Could not read local/remote synchronization state.", { output });
  }
  return { ahead, behind };
}

function assertInitiallySynchronized(repo, options) {
  const heads = remoteHeads(repo, options.remote);
  const expectedRef = `refs/heads/${options.branch}`;
  if (!heads.includes(expectedRef)) {
    if (!hasLocalHead(repo) && heads.length === 0) {
      return { initializeRemote: true };
    }
    throw new CloseoutError("remote_branch_not_found", `Remote ${options.remote}/${options.branch} does not exist.`, {
      remoteHeads: heads,
    });
  }
  if (!hasLocalHead(repo)) {
    throw new CloseoutError("history_not_synchronized", "Local and remote history must match before closeout.", {
      ahead: 0,
      behind: 1,
    });
  }
  const counts = syncCounts(repo, options.remote, options.branch);
  if (counts.behind !== 0) {
    throw new CloseoutError("history_not_synchronized", "Remote history is ahead or diverged; the shared checkout was not changed.", counts);
  }
  return { initializeRemote: false, ahead: counts.ahead };
}

function treeEntries(repo, tree, paths) {
  if (!tree) return [];
  return splitNull(runGit(repo, ["ls-tree", "-r", "-z", tree, "--", ...paths]).stdout).sort();
}

function sameList(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function snapshotSelectedTree(repo, base, ownedPaths) {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "shzw-closeout-index-"));
  const indexFile = path.join(directory, "index");
  try {
    runGit(repo, base ? ["read-tree", base] : ["read-tree", "--empty"], { indexFile });
    runGit(repo, ["add", "--", ...ownedPaths], { indexFile });
    return runGit(repo, ["write-tree"], { indexFile }).stdout.trim();
  } finally {
    // These are files owned by this invocation, not a repository index or lock.
    if (fs.existsSync(indexFile)) fs.unlinkSync(indexFile);
    if (fs.existsSync(`${indexFile}.lock`)) fs.unlinkSync(`${indexFile}.lock`);
    fs.rmdirSync(directory);
  }
}

function commitParents(repo, sha) {
  const [actual, ...parents] = gitText(repo, ["rev-list", "--parents", "-n", "1", sha]).split(/\s+/);
  if (actual !== sha || parents.length > 1) {
    throw new CloseoutError("unsupported_commit", "Only an exact, non-merge commit can be published by this tool.", { sha });
  }
  return parents;
}

function commitFiles(repo, sha) {
  return splitNull(runGit(repo, ["diff-tree", "--root", "--no-commit-id", "--no-renames", "-r", "--name-only", "-z", sha]).stdout).sort();
}

function findCommit(repo, branch, marker, commitOutput) {
  const log = runGit(repo, ["reflog", "show", "--format=%H%x00%gs", "-n", "500", `refs/heads/${branch}`], { allowFailure: true });
  if (log.status === 0) {
    const candidates = [];
    for (const line of log.stdout.split(/\r?\n/)) {
      const [sha, subject] = line.split("\0");
      if (subject?.startsWith(`${marker}: `) && !candidates.includes(sha)) candidates.push(sha);
    }
    if (candidates.length > 1) {
      throw new CloseoutError("commit_identity_ambiguous", "Multiple commits used this invocation's marker; no push was attempted.", { candidates }, 3);
    }
    if (candidates.length === 1) return candidates[0];
  }
  const matches = [...commitOutput.matchAll(/(?:^|\n)\[[^\r\n\]]*? ([a-f0-9]{7,64})\](?=\s|$)/gi)];
  if (matches.length > 1) {
    throw new CloseoutError("commit_identity_ambiguous", "Multiple commit summaries were printed; no push was attempted.", {}, 3);
  }
  if (matches.length === 1) {
    const lookup = runGit(repo, ["rev-parse", "--verify", `${matches[0][1]}^{commit}`], { allowFailure: true });
    if (lookup.status === 0) return lookup.stdout.trim();
  }
  return null;
}

function isAncestor(repo, ancestor, descendant) {
  const result = runGit(repo, ["merge-base", "--is-ancestor", ancestor, descendant], { allowFailure: true });
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new CloseoutError("history_unreadable", "Could not verify commit ancestry.", { ancestor, descendant });
}

function waitBriefly(deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return false;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(500, remaining));
  return true;
}

function isIndexLockFailure(result) {
  return /index\.lock|cannot lock ref/i.test(`${result.stderr}\n${result.stdout}`);
}

function currentRemoteHead(repo, options) {
  const records = remoteHeadRecords(repo, options.remote);
  const heads = records.map(({ ref }) => ref);
  const target = records.find(({ ref }) => ref === `refs/heads/${options.branch}`);
  if (!target) return { heads, sha: null };
  if (runGit(repo, ["cat-file", "-e", `${target.sha}^{commit}`], { allowFailure: true }).status !== 0) {
    runGit(repo, ["fetch", "--no-tags", options.remote, options.branch]);
    if (runGit(repo, ["cat-file", "-e", `${target.sha}^{commit}`], { allowFailure: true }).status !== 0) {
      throw new CloseoutError("remote_state_unreadable", "The observed remote commit is no longer available locally.", { remoteHead: target.sha });
    }
  }
  return { heads, sha: target.sha };
}

function publishCommit(repo, options, sha, changedFiles) {
  const parents = commitParents(repo, sha);
  const parent = parents[0] || null;
  const deadline = Date.now() + options.waitSeconds * 1000;
  let failedPush = null;
  let failedAt = null;
  let successfulPush = false;
  while (true) {
    assertCheckout(repo, options);
    const remote = currentRemoteHead(repo, options);
    if (remote.sha && isAncestor(repo, sha, remote.sha)) {
      return { status: "pushed", sha, changedFiles, remote: options.remote, branch: options.branch, remoteHead: remote.sha };
    }
    if (successfulPush) {
      throw new CloseoutError("push_not_verified", "Push returned successfully but the remote no longer contains this commit.", { sha, remoteHead: remote.sha }, 3);
    }
    const canPush = parent ? remote.sha === parent : !remote.sha && remote.heads.length === 0;
    if (canPush) {
      if (failedPush && failedAt === remote.sha) {
        throw new CloseoutError("push_failed", "The local commit exists but push failed.", {
          sha, stderr: sanitizeGitOutput(failedPush.stderr.trim()), stdout: sanitizeGitOutput(failedPush.stdout.trim()),
        }, 3);
      }
      failedAt = remote.sha;
      failedPush = runGit(repo, ["push", options.remote, `${sha}:refs/heads/${options.branch}`], { allowFailure: true });
      if (failedPush.status === 0) {
        failedPush = null;
        successfulPush = true;
      }
      continue;
    }
    if (parent && remote.sha && isAncestor(repo, remote.sha, parent)) {
      if (waitBriefly(deadline)) continue;
      throw new CloseoutError("parent_not_published", "This exact commit is local; its earlier parent must be published by its owner before this commit can be pushed.", {
        sha, parent, remoteHead: remote.sha,
      }, 3);
    }
    throw new CloseoutError("remote_changed_after_commit", "Remote history is incompatible with this exact commit; push was not attempted.", {
      sha, parent, remoteHead: remote.sha, remoteHeads: remote.heads,
    }, 3);
  }
}

function verifyCommit(repo, sha, base, expectedTree, changedFiles, ownedPaths, requireExactTree) {
  const parents = commitParents(repo, sha);
  const parent = parents[0] || null;
  const actualFiles = commitFiles(repo, sha);
  const expected = treeEntries(repo, expectedTree, changedFiles);
  const actual = treeEntries(repo, sha, changedFiles);
  if (!sameList(actualFiles, changedFiles) || !sameList(expected, actual)) {
    throw new CloseoutError("commit_scope_changed", "A hook or concurrent change altered the verified commit; it was not pushed.", {
      sha, expectedFiles: changedFiles, actualFiles,
    }, 3);
  }
  if (requireExactTree && gitText(repo, ["rev-parse", `${sha}^{tree}`]) !== expectedTree) {
    throw new CloseoutError("verified_tree_changed", "The resulting commit differs from the tree that was verified; it was not pushed.", { sha, expectedTree }, 3);
  }
  if ((!base && parent) || (base && (!parent || !isAncestor(repo, base, parent))) ||
      !sameList(treeEntries(repo, base, ownedPaths), treeEntries(repo, parent, ownedPaths))) {
    throw new CloseoutError("commit_base_changed", "A selected path or the history changed during the commit; it was not pushed.", {
      sha, base, parent,
    }, 3);
  }
}

function commitAndPush(repo, options, ownedPaths, changedFiles) {
  const base = hasLocalHead(repo) ? gitText(repo, ["rev-parse", "HEAD"]) : null;
  const expectedTree = snapshotSelectedTree(repo, base, ownedPaths);
  if (options.expectedTree && expectedTree.toLowerCase() !== options.expectedTree.toLowerCase()) {
    throw new CloseoutError("verified_tree_changed", "The selected files or their base changed after verification; no commit was created.", {
      expectedTree: options.expectedTree, actualTree: expectedTree,
    });
  }
  const untracked = splitNull(runGit(repo, ["ls-files", "--others", "--exclude-standard", "-z", "--", ...ownedPaths]).stdout)
    .filter((file) => ownedPaths.includes(file));
  const deadline = Date.now() + options.waitSeconds * 1000;
  assertNoOverlappingStaged(repo, ownedPaths, options.includeStagedOwned);
  if (untracked.length) {
    let add;
    do {
      add = runGit(repo, ["add", "--intent-to-add", "--", ...untracked], { allowFailure: true });
    } while (add.status !== 0 && isIndexLockFailure(add) && waitBriefly(deadline));
    if (add.status !== 0) {
      throw new CloseoutError("prepare_new_files_failed", "Git could not prepare the new selected files.", {
        stderr: sanitizeGitOutput(add.stderr.trim()), stdout: sanitizeGitOutput(add.stdout.trim()),
      });
    }
  }
  const marker = `shzw-closeout-${randomUUID()}`;
  let commit;
  let sha = null;
  do {
    assertNoOverlappingStaged(repo, ownedPaths, options.includeStagedOwned);
    commit = runGit(repo, ["-c", "core.abbrev=40", "-c", "color.ui=false", "commit", "--only", "-m", options.message, "--", ...ownedPaths], {
      allowFailure: true, extraEnv: { GIT_REFLOG_ACTION: marker, LC_ALL: "C" },
    });
    sha = findCommit(repo, options.branch, marker, commit.stdout);
  } while (commit.status !== 0 && !sha && isIndexLockFailure(commit) && waitBriefly(deadline));
  if (commit.status !== 0 && sha) {
    throw new CloseoutError("commit_failed_after_ref_change", "Git reported a failed commit after a matching ref change; inspect it before pushing.", {
      sha, stderr: sanitizeGitOutput(commit.stderr.trim()), stdout: sanitizeGitOutput(commit.stdout.trim()),
    }, 3);
  }
  if (commit.status !== 0) {
    throw new CloseoutError("commit_failed", "Git commit failed; existing staged content was left untouched. New files may retain an intent-to-add entry.", {
      stderr: sanitizeGitOutput(commit.stderr.trim()), stdout: sanitizeGitOutput(commit.stdout.trim()), intentToAdd: untracked,
    });
  }
  if (!sha) {
    throw new CloseoutError("commit_identity_unknown", "A commit may have been created, but its exact SHA could not be determined; push was not attempted.", {}, 3);
  }
  try {
    verifyCommit(repo, sha, base, expectedTree, changedFiles, ownedPaths, Boolean(options.expectedTree));
    return publishCommit(repo, options, sha, changedFiles);
  } catch (error) {
    if (error instanceof CloseoutError) {
      error.exitCode = 3;
      error.details = { sha, ...error.details };
    }
    throw error;
  }
}

function resumeCommit(repo, options, ownedPaths) {
  const sha = gitText(repo, ["rev-parse", "--verify", `${options.commit}^{commit}`]);
  if (sha.toLowerCase() !== options.commit.toLowerCase() || !isAncestor(repo, sha, "HEAD")) {
    throw new CloseoutError("commit_not_on_branch", "The supplied immutable commit is not on the current branch.", { sha });
  }
  const changedFiles = commitFiles(repo, sha);
  if (!changedFiles.length || changedFiles.some((file) => !ownedPaths.includes(file))) {
    throw new CloseoutError("commit_scope_mismatch", "The supplied commit includes paths outside the declared owned set.", { sha, changedFiles, ownedPaths });
  }
  if (options.expectedTree && gitText(repo, ["rev-parse", `${sha}^{tree}`]).toLowerCase() !== options.expectedTree.toLowerCase()) {
    throw new CloseoutError("verified_tree_changed", "The supplied commit does not contain the verified tree; it was not pushed.", { sha, expectedTree: options.expectedTree }, 3);
  }
  try {
    return publishCommit(repo, options, sha, changedFiles);
  } catch (error) {
    if (error instanceof CloseoutError) {
      error.exitCode = 3;
      error.details = { sha, ...error.details };
    }
    throw error;
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const repo = fs.realpathSync(path.resolve(options.repo));
  assertCheckout(repo, options);
  assertNoOperationInProgress(repo);
  const ownedPaths = [...new Set(options.paths.map((value) => normalizeOwnedPath(repo, value, { allowMissing: options.mode === "push-commit" })))].sort();
  if (options.mode === "push-commit") return resumeCommit(repo, options, ownedPaths);
  assertNoOverlappingStaged(repo, ownedPaths, options.includeStagedOwned);
  const changedFiles = selectedChanges(repo, ownedPaths, options.includeStagedOwned);
  if (options.mode === "snapshot") {
    const base = hasLocalHead(repo) ? gitText(repo, ["rev-parse", "HEAD"]) : null;
    const tree = snapshotSelectedTree(repo, base, ownedPaths);
    return { status: "snapshot", base, tree, changedFiles };
  }
  const syncState = assertInitiallySynchronized(repo, options);
  if (changedFiles.length === 0) {
    const staged = overlappingStaged(repo, ownedPaths);
    if (staged.length) {
      throw new CloseoutError("staged_without_working_change", "Selected staged content differs from the working tree, which has no final change; it was left untouched.", { staged });
    }
    if (syncState.ahead) {
      throw new CloseoutError("pending_local_commits", "No selected working files changed, but the local branch has unpublished commits; inspect ownership before resuming an exact commit.", {
        ahead: syncState.ahead, head: gitText(repo, ["rev-parse", "HEAD"]), ownedPaths,
      });
    }
    return { status: "skip_no_changes", ownedPaths };
  }
  if (options.mode === "check") {
    return {
      status: "ready",
      changedFiles,
      remote: options.remote,
      branch: options.branch,
      initializeRemote: syncState.initializeRemote,
      pendingParentCommits: syncState.ahead || 0,
      verification: options.verification.trim(),
    };
  }

  return commitAndPush(repo, options, ownedPaths, changedFiles);
}

try {
  const result = main();
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  const controlled = error instanceof CloseoutError
    ? error
    : new CloseoutError("unexpected_error", error instanceof Error ? error.message : String(error), {}, 1);
  process.stdout.write(`${JSON.stringify({
    status: "stopped",
    code: controlled.code,
    message: controlled.message,
    ...controlled.details,
  })}\n`);
  process.exitCode = controlled.exitCode;
}
