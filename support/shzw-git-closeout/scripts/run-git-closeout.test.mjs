import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const runner = path.join(path.dirname(fileURLToPath(import.meta.url)), "run-git-closeout.mjs");

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function write(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, "utf8");
}

function createRepository() {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(tempRoot, "git-closeout-"));
  const remote = path.join(root, "remote.git");
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  git(root, ["init", "--bare", remote]);
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.name", "Git Closeout Test"]);
  git(repo, ["config", "user.email", "git-closeout@example.invalid"]);
  write(path.join(repo, "owned.txt"), "base\n");
  write(path.join(repo, "other.txt"), "base\n");
  git(repo, ["add", "owned.txt", "other.txt"]);
  git(repo, ["commit", "-m", "initial"]);
  git(repo, ["remote", "add", "origin", remote]);
  git(repo, ["push", "-u", "origin", "main"]);
  return { root, expectedRoot: fs.realpathSync(root), tempRoot, remote, repo };
}

function createEmptyRepository({ configureIdentity = true } = {}) {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(tempRoot, "git-closeout-empty-"));
  const remote = path.join(root, "remote.git");
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  git(root, ["init", "--bare", remote]);
  git(repo, ["init", "-b", "main"]);
  if (configureIdentity) {
    git(repo, ["config", "user.name", "Git Closeout Test"]);
    git(repo, ["config", "user.email", "git-closeout@example.invalid"]);
  }
  git(repo, ["remote", "add", "origin", remote]);
  write(path.join(repo, "owned.txt"), "initial content\n");
  return { root, expectedRoot: fs.realpathSync(root), tempRoot, remote, repo };
}

function cleanupFixture(fixture) {
  if (!fs.existsSync(fixture.root)) return;
  const resolved = fs.realpathSync(fixture.root);
  assert.equal(resolved, fixture.expectedRoot, "fixture root changed");
  assert.equal(path.dirname(resolved), fixture.tempRoot, "fixture escaped its temporary parent");
  assert.match(path.basename(resolved), /^git-closeout-/);
  fs.rmSync(resolved, { recursive: true, force: true });
}

function run(repo, extra = []) {
  const result = spawnSync(process.execPath, [
    runner,
    "--repo", repo,
    "--verification", "focused tests passed",
    "--wait-seconds", "0",
    ...extra,
  ], { encoding: "utf8", windowsHide: true });
  const output = result.stdout.trim();
  return { ...result, json: output ? JSON.parse(output) : null };
}

function runAsync(repo, extra = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runner, "--repo", repo, "--verification", "focused tests passed", ...extra], {
      encoding: "utf8", windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", reject);
    child.on("close", (status) => {
      try { resolve({ status, stdout, stderr, json: JSON.parse(stdout.trim()) }); }
      catch (error) { reject(error); }
    });
  });
}

test("commits and pushes only owned files while preserving unrelated unstaged changes", (t) => {
  const fixture = createRepository();
  t.after(() => cleanupFixture(fixture));
  write(path.join(fixture.repo, "owned.txt"), "owned change\n");
  write(path.join(fixture.repo, "other.txt"), "unrelated change\n");

  const result = run(fixture.repo, [
    "--mode", "commit-push",
    "--message", "test: exact closeout",
    "--path", "owned.txt",
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.json.status, "pushed");
  assert.deepEqual(git(fixture.repo, ["show", "--pretty=", "--name-only", "HEAD"]).split(/\r?\n/).filter(Boolean), ["owned.txt"]);
  assert.equal(git(fixture.repo, ["status", "--short"]), "M other.txt");
  assert.equal(git(fixture.repo, ["rev-parse", "HEAD"]), git(fixture.repo, ["rev-parse", "origin/main"]));
});

test("initializes an entirely empty origin main with one exact commit", (t) => {
  const fixture = createEmptyRepository();
  t.after(() => cleanupFixture(fixture));

  const result = run(fixture.repo, [
    "--mode", "commit-push",
    "--message", "test: initialize empty remote",
    "--path", "owned.txt",
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.json.status, "pushed");
  assert.equal(git(fixture.repo, ["rev-parse", "HEAD"]), git(fixture.repo, ["rev-parse", "origin/main"]));
  assert.equal(git(fixture.repo, ["status", "--short"]), "");
});

test("rejects remote initialization when another remote branch already exists", (t) => {
  const fixture = createEmptyRepository();
  t.after(() => cleanupFixture(fixture));
  const peer = path.join(fixture.root, "peer");
  fs.mkdirSync(peer);
  git(peer, ["init", "-b", "other"]);
  git(peer, ["config", "user.name", "Peer"]);
  git(peer, ["config", "user.email", "peer@example.invalid"]);
  write(path.join(peer, "peer.txt"), "remote content\n");
  git(peer, ["add", "peer.txt"]);
  git(peer, ["commit", "-m", "peer initial"]);
  git(peer, ["remote", "add", "origin", fixture.remote]);
  git(peer, ["push", "origin", "other"]);

  const result = run(fixture.repo, [
    "--mode", "commit-push",
    "--message", "test: blocked initialization",
    "--path", "owned.txt",
  ]);

  assert.equal(result.status, 2);
  assert.equal(result.json.code, "remote_branch_not_found");
  assert.equal(git(fixture.repo, ["status", "--short"]), "?? owned.txt");
});

test("a failed initial commit leaves no staged content or foreign index changes", (t) => {
  const fixture = createEmptyRepository({ configureIdentity: false });
  t.after(() => cleanupFixture(fixture));

  const result = run(fixture.repo, [
    "--mode", "commit-push",
    "--message", "test: missing identity",
    "--path", "owned.txt",
  ]);

  assert.equal(result.status, 2);
  assert.equal(result.json.code, "commit_failed");
  assert.equal(git(fixture.repo, ["diff", "--cached", "--name-only"]), "");
  assert.equal(git(fixture.repo, ["status", "--short"]), "A owned.txt");
  assert.deepEqual(result.json.intentToAdd, ["owned.txt"]);
});

test("returns skip_no_changes without creating a commit", (t) => {
  const fixture = createRepository();
  t.after(() => cleanupFixture(fixture));
  const before = git(fixture.repo, ["rev-parse", "HEAD"]);

  const result = run(fixture.repo, ["--mode", "commit-push", "--message", "test: no-op", "--path", "owned.txt"]);

  assert.equal(result.status, 0);
  assert.equal(result.json.status, "skip_no_changes");
  assert.equal(git(fixture.repo, ["rev-parse", "HEAD"]), before);
});

test("snapshots the exact candidate without consuming another staged change", (t) => {
  const fixture = createRepository();
  t.after(() => cleanupFixture(fixture));
  write(path.join(fixture.repo, "owned.txt"), "candidate contents\n");
  write(path.join(fixture.repo, "other.txt"), "foreign staged\n");
  git(fixture.repo, ["add", "other.txt"]);
  const snapshotRun = spawnSync(process.execPath, [runner, "--repo", fixture.repo, "--mode", "snapshot", "--path", "owned.txt"], {
    encoding: "utf8", windowsHide: true,
  });
  assert.equal(snapshotRun.status, 0, snapshotRun.stdout);
  const snapshot = JSON.parse(snapshotRun.stdout);
  assert.equal(snapshot.status, "snapshot");
  assert.equal(git(fixture.repo, ["show", `${snapshot.tree}:owned.txt`]), "candidate contents");
  assert.equal(git(fixture.repo, ["show", `${snapshot.tree}:other.txt`]), "base");
  assert.equal(git(fixture.repo, ["show", ":other.txt"]), "foreign staged");

  const result = run(fixture.repo, ["--mode", "commit-push", "--message", "test: verified tree", "--expected-tree", snapshot.tree, "--path", "owned.txt"]);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(git(fixture.repo, ["rev-parse", `${result.json.sha}^{tree}`]), snapshot.tree);
  assert.equal(git(fixture.repo, ["show", ":other.txt"]), "foreign staged");
});

test("rejects a candidate changed after its snapshot without committing it", (t) => {
  const fixture = createRepository();
  t.after(() => cleanupFixture(fixture));
  write(path.join(fixture.repo, "owned.txt"), "verified content\n");
  const snapshot = run(fixture.repo, ["--mode", "snapshot", "--path", "owned.txt"]);
  assert.equal(snapshot.status, 0, snapshot.stdout);
  write(path.join(fixture.repo, "owned.txt"), "changed after validation\n");
  const before = git(fixture.repo, ["rev-parse", "HEAD"]);

  const result = run(fixture.repo, ["--mode", "commit-push", "--message", "test: stale tree", "--expected-tree", snapshot.json.tree, "--path", "owned.txt"]);
  assert.equal(result.status, 2, result.stdout);
  assert.equal(result.json.code, "verified_tree_changed");
  assert.equal(git(fixture.repo, ["rev-parse", "HEAD"]), before);
  assert.equal(git(fixture.repo, ["diff", "--cached", "--name-only"]), "");
});

test("refuses to resume a commit whose tree is not the verified candidate", (t) => {
  const fixture = createRepository();
  t.after(() => cleanupFixture(fixture));
  write(path.join(fixture.repo, "owned.txt"), "candidate\n");
  const snapshot = run(fixture.repo, ["--mode", "snapshot", "--path", "owned.txt"]);
  write(path.join(fixture.repo, "owned.txt"), "different content\n");
  git(fixture.repo, ["add", "owned.txt"]);
  git(fixture.repo, ["commit", "-m", "test: different tree"]);
  const sha = git(fixture.repo, ["rev-parse", "HEAD"]);

  const result = run(fixture.repo, ["--mode", "push-commit", "--commit", sha, "--expected-tree", snapshot.json.tree, "--path", "owned.txt"]);
  assert.equal(result.status, 3, result.stdout);
  assert.equal(result.json.code, "verified_tree_changed");
  assert.notEqual(git(fixture.repo, ["ls-remote", "origin", "refs/heads/main"]).split(/\s+/)[0], sha);
});

test("rejects missing verification evidence", (t) => {
  const fixture = createRepository();
  t.after(() => cleanupFixture(fixture));
  write(path.join(fixture.repo, "owned.txt"), "changed\n");

  const result = spawnSync(process.execPath, [runner, "--repo", fixture.repo, "--path", "owned.txt", "--message", "test: blocked"], {
    encoding: "utf8",
    windowsHide: true,
  });

  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).code, "verification_required");
  assert.equal(git(fixture.repo, ["status", "--short"]), "M owned.txt");
});

test("preserves an unrelated staged file while committing and pushing only the owned file", (t) => {
  const fixture = createRepository();
  t.after(() => cleanupFixture(fixture));
  write(path.join(fixture.repo, "owned.txt"), "owned change\n");
  write(path.join(fixture.repo, "other.txt"), "staged elsewhere\n");
  git(fixture.repo, ["add", "other.txt"]);

  const result = run(fixture.repo, ["--mode", "commit-push", "--message", "test: blocked", "--path", "owned.txt"]);

  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.json.status, "pushed");
  assert.equal(git(fixture.repo, ["show", "--pretty=", "--name-only", "HEAD"]), "owned.txt");
  assert.equal(git(fixture.repo, ["diff", "--cached", "--name-only"]), "other.txt");
  assert.equal(git(fixture.repo, ["show", ":other.txt"]), "staged elsewhere");
});

test("rejects staged changes on a selected file and preserves them", (t) => {
  const fixture = createRepository();
  t.after(() => cleanupFixture(fixture));
  write(path.join(fixture.repo, "owned.txt"), "first staged edit\n");
  git(fixture.repo, ["add", "owned.txt"]);
  write(path.join(fixture.repo, "owned.txt"), "additional working edit\n");
  const before = git(fixture.repo, ["rev-parse", "HEAD"]);

  const result = run(fixture.repo, ["--mode", "commit-push", "--message", "test: blocked", "--path", "owned.txt"]);

  assert.equal(result.status, 2);
  assert.equal(result.json.code, "overlapping_staged_changes");
  assert.equal(git(fixture.repo, ["show", ":owned.txt"]), "first staged edit");
  assert.equal(fs.readFileSync(path.join(fixture.repo, "owned.txt"), "utf8"), "additional working edit\n");
  assert.equal(git(fixture.repo, ["rev-parse", "HEAD"]), before);
});

test("commits a fully owned staged and working file only when explicitly declared", (t) => {
  const fixture = createRepository();
  t.after(() => cleanupFixture(fixture));
  write(path.join(fixture.repo, "owned.txt"), "owned staged edit\n");
  write(path.join(fixture.repo, "other.txt"), "foreign staged edit\n");
  git(fixture.repo, ["add", "owned.txt", "other.txt"]);
  write(path.join(fixture.repo, "owned.txt"), "verified final owned edit\n");

  const result = run(fixture.repo, ["--mode", "commit-push", "--include-staged-owned", "--message", "test: owned staged", "--path", "owned.txt"]);

  assert.equal(result.status, 0, result.stdout);
  assert.equal(git(fixture.repo, ["show", "HEAD:owned.txt"]), "verified final owned edit");
  assert.equal(git(fixture.repo, ["show", "--pretty=", "--name-only", "HEAD"]), "owned.txt");
  assert.equal(git(fixture.repo, ["diff", "--cached", "--name-only"]), "other.txt");
  assert.equal(git(fixture.repo, ["show", ":other.txt"]), "foreign staged edit");
});

test("commits an explicitly owned staged deletion without touching other staged files", (t) => {
  const fixture = createRepository();
  t.after(() => cleanupFixture(fixture));
  write(path.join(fixture.repo, "other.txt"), "foreign staged edit\n");
  git(fixture.repo, ["add", "other.txt"]);
  git(fixture.repo, ["rm", "owned.txt"]);

  const result = run(fixture.repo, ["--mode", "commit-push", "--include-staged-owned", "--message", "test: delete owned", "--path", "owned.txt"]);

  assert.equal(result.status, 0, result.stdout);
  assert.equal(git(fixture.repo, ["show", "--pretty=", "--name-only", "HEAD"]), "owned.txt");
  assert.equal(git(fixture.repo, ["diff", "--cached", "--name-only"]), "other.txt");
  assert.equal(fs.existsSync(path.join(fixture.repo, "owned.txt")), false);
});

test("preserves a staged version when the selected working file has no final change", (t) => {
  const fixture = createRepository();
  t.after(() => cleanupFixture(fixture));
  write(path.join(fixture.repo, "owned.txt"), "staged content\n");
  git(fixture.repo, ["add", "owned.txt"]);
  write(path.join(fixture.repo, "owned.txt"), "base\n");

  const result = run(fixture.repo, ["--mode", "commit-push", "--include-staged-owned", "--message", "test: staged only", "--path", "owned.txt"]);

  assert.equal(result.status, 2, result.stdout);
  assert.equal(result.json.code, "staged_without_working_change");
  assert.equal(git(fixture.repo, ["show", ":owned.txt"]), "staged content");
});

test("a rejected hook preserves both selected and unrelated staged versions", (t) => {
  const fixture = createRepository();
  t.after(() => cleanupFixture(fixture));
  write(path.join(fixture.repo, "owned.txt"), "owned staged\n");
  write(path.join(fixture.repo, "other.txt"), "foreign staged\n");
  git(fixture.repo, ["add", "owned.txt", "other.txt"]);
  write(path.join(fixture.repo, "owned.txt"), "owned final\n");
  write(path.join(fixture.repo, ".git/hooks/pre-commit"), "#!/bin/sh\nexit 1\n");
  fs.chmodSync(path.join(fixture.repo, ".git/hooks/pre-commit"), 0o755);

  const result = run(fixture.repo, ["--mode", "commit-push", "--include-staged-owned", "--message", "test: rejected", "--path", "owned.txt"]);

  assert.equal(result.status, 2, result.stdout);
  assert.equal(result.json.code, "commit_failed");
  assert.equal(git(fixture.repo, ["show", ":owned.txt"]), "owned staged");
  assert.equal(git(fixture.repo, ["show", ":other.txt"]), "foreign staged");
  assert.equal(fs.readFileSync(path.join(fixture.repo, "owned.txt"), "utf8"), "owned final\n");
});

test("rejects a non-default branch without explicit authorization", (t) => {
  const fixture = createRepository();
  t.after(() => cleanupFixture(fixture));
  git(fixture.repo, ["switch", "-c", "topic"]);
  write(path.join(fixture.repo, "owned.txt"), "changed\n");

  const result = run(fixture.repo, ["--mode", "commit-push", "--message", "test: blocked", "--path", "owned.txt"]);

  assert.equal(result.status, 2);
  assert.equal(result.json.code, "branch_not_allowed");
  assert.equal(git(fixture.repo, ["log", "-1", "--pretty=%s"]), "initial");
});

test("commits an untracked owned file without consuming another staged file", (t) => {
  const fixture = createRepository();
  t.after(() => cleanupFixture(fixture));
  write(path.join(fixture.repo, "other.txt"), "other staged\n");
  git(fixture.repo, ["add", "other.txt"]);
  write(path.join(fixture.repo, "new.txt"), "new owned file\n");

  const result = run(fixture.repo, ["--mode", "commit-push", "--message", "test: new file", "--path", "new.txt"]);

  assert.equal(result.status, 0, result.stdout);
  assert.equal(git(fixture.repo, ["show", "--pretty=", "--name-only", "HEAD"]), "new.txt");
  assert.equal(git(fixture.repo, ["show", ":other.txt"]), "other staged");
  assert.equal(git(fixture.repo, ["diff", "--cached", "--name-only"]), "other.txt");
});

test("commits both sides of an owned rename without touching another staged file", (t) => {
  const fixture = createRepository();
  t.after(() => cleanupFixture(fixture));
  write(path.join(fixture.repo, "other.txt"), "foreign staged\n");
  git(fixture.repo, ["add", "other.txt"]);
  fs.renameSync(path.join(fixture.repo, "owned.txt"), path.join(fixture.repo, "renamed.txt"));

  const result = run(fixture.repo, ["--mode", "commit-push", "--message", "test: rename", "--path", "owned.txt", "--path", "renamed.txt"]);

  assert.equal(result.status, 0, result.stdout);
  assert.deepEqual(git(fixture.repo, ["diff-tree", "--no-commit-id", "--no-renames", "-r", "--name-only", "HEAD"]).split(/\r?\n/).sort(), ["owned.txt", "renamed.txt"]);
  assert.equal(git(fixture.repo, ["show", ":other.txt"]), "foreign staged");
});

test("does not push a hook-added unrelated file", (t) => {
  const fixture = createRepository();
  t.after(() => cleanupFixture(fixture));
  const remoteBefore = git(fixture.repo, ["rev-parse", "origin/main"]);
  write(path.join(fixture.repo, "owned.txt"), "owned change\n");
  write(path.join(fixture.repo, "other.txt"), "foreign change\n");
  write(path.join(fixture.repo, ".git/hooks/pre-commit"), "#!/bin/sh\ngit add -- other.txt\n");
  fs.chmodSync(path.join(fixture.repo, ".git/hooks/pre-commit"), 0o755);

  const result = run(fixture.repo, ["--mode", "commit-push", "--message", "test: hook", "--path", "owned.txt"]);

  assert.equal(result.status, 3, result.stdout);
  assert.equal(result.json.code, "commit_scope_changed");
  assert.deepEqual(result.json.actualFiles, ["other.txt", "owned.txt"]);
  assert.equal(git(fixture.repo, ["rev-parse", "HEAD"]), result.json.sha);
  assert.equal(git(fixture.repo, ["ls-remote", "origin", "refs/heads/main"]).split(/\s+/)[0], remoteBefore);
});

test("does not push when a hook changes the selected file after the snapshot", (t) => {
  const fixture = createRepository();
  t.after(() => cleanupFixture(fixture));
  const remoteBefore = git(fixture.repo, ["rev-parse", "origin/main"]);
  write(path.join(fixture.repo, "owned.txt"), "verified content\n");
  write(path.join(fixture.repo, ".git/hooks/pre-commit"), "#!/bin/sh\nprintf 'hook changed content\\n' > owned.txt\ngit add -- owned.txt\n");
  fs.chmodSync(path.join(fixture.repo, ".git/hooks/pre-commit"), 0o755);

  const result = run(fixture.repo, ["--mode", "commit-push", "--message", "test: hook", "--path", "owned.txt"]);

  assert.equal(result.status, 3, result.stdout);
  assert.equal(result.json.code, "commit_scope_changed");
  assert.equal(git(fixture.repo, ["show", "HEAD:owned.txt"]), "hook changed content");
  assert.equal(git(fixture.repo, ["ls-remote", "origin", "refs/heads/main"]).split(/\s+/)[0], remoteBefore);
});

test("stops after the local commit if another checkout advances the remote", (t) => {
  const fixture = createRepository();
  t.after(() => cleanupFixture(fixture));
  const peer = path.join(fixture.root, "peer");
  git(fixture.root, ["clone", "-b", "main", fixture.remote, peer]);
  git(peer, ["config", "user.name", "Peer"]);
  git(peer, ["config", "user.email", "peer@example.invalid"]);
  write(path.join(peer, "peer.txt"), "remote advance\n");
  const shellPeer = peer.replaceAll("\\", "/").replaceAll("'", "'\\''");
  write(path.join(fixture.repo, ".git/hooks/post-commit"), [
    "#!/bin/sh",
    "unset GIT_INDEX_FILE GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_PREFIX GIT_REFLOG_ACTION",
    `git -C '${shellPeer}' add -- peer.txt || exit 1`,
    `git -C '${shellPeer}' commit -m 'test: peer advance' || exit 1`,
    `git -C '${shellPeer}' push origin main || exit 1`,
    "",
  ].join("\n"));
  fs.chmodSync(path.join(fixture.repo, ".git/hooks/post-commit"), 0o755);
  write(path.join(fixture.repo, "owned.txt"), "owned change\n");

  const result = run(fixture.repo, ["--mode", "commit-push", "--message", "test: local", "--path", "owned.txt"]);

  assert.equal(result.status, 3, result.stdout);
  assert.equal(result.json.code, "remote_changed_after_commit");
  assert.equal(git(fixture.repo, ["rev-parse", "HEAD"]), result.json.sha);
  assert.equal(git(fixture.repo, ["ls-remote", "origin", "refs/heads/main"]).split(/\s+/)[0], git(peer, ["rev-parse", "HEAD"]));
  assert.notEqual(git(peer, ["rev-parse", "HEAD"]), result.json.sha);
});

test("does not guess which commit belongs to a hook that creates another commit", (t) => {
  const fixture = createRepository();
  t.after(() => cleanupFixture(fixture));
  const remoteBefore = git(fixture.repo, ["rev-parse", "origin/main"]);
  write(path.join(fixture.repo, "owned.txt"), "owned change\n");
  write(path.join(fixture.repo, ".git/hooks/post-commit"), [
    "#!/bin/sh",
    "if test ! -f .git/hook-ran; then",
    "  touch .git/hook-ran",
    "  printf 'nested hook change\\n' > other.txt",
    "  git add -- other.txt",
    "  git commit -m 'test: nested hook'",
    "fi",
    "",
  ].join("\n"));
  fs.chmodSync(path.join(fixture.repo, ".git/hooks/post-commit"), 0o755);

  const result = run(fixture.repo, ["--mode", "commit-push", "--message", "test: owned", "--path", "owned.txt"]);

  assert.equal(result.status, 3, result.stdout);
  assert.equal(result.json.code, "commit_identity_ambiguous");
  assert.equal(result.json.candidates.length, 2);
  assert.equal(git(fixture.repo, ["ls-remote", "origin", "refs/heads/main"]).split(/\s+/)[0], remoteBefore);
});

test("recognizes an already committed but unpushed result and resumes its exact commit", (t) => {
  const fixture = createRepository();
  t.after(() => cleanupFixture(fixture));
  write(path.join(fixture.repo, "owned.txt"), "earlier verified work\n");
  git(fixture.repo, ["add", "owned.txt"]);
  git(fixture.repo, ["commit", "-m", "test: earlier owned work"]);
  const ownedCommit = git(fixture.repo, ["rev-parse", "HEAD"]);

  const check = run(fixture.repo, ["--mode", "check", "--path", "owned.txt"]);
  assert.equal(check.status, 2, check.stdout);
  assert.equal(check.json.code, "pending_local_commits");
  assert.equal(check.json.head, ownedCommit);
  const resumed = run(fixture.repo, ["--mode", "push-commit", "--commit", ownedCommit, "--path", "owned.txt"]);
  assert.equal(resumed.status, 0, resumed.stdout);
  assert.equal(resumed.json.sha, ownedCommit);
  assert.equal(git(fixture.repo, ["ls-remote", "origin", "refs/heads/main"]).split(/\s+/)[0], ownedCommit);
});

test("records independent work locally while waiting for another unpushed parent", (t) => {
  const fixture = createRepository();
  t.after(() => cleanupFixture(fixture));
  const originalRemote = git(fixture.repo, ["rev-parse", "origin/main"]);
  write(path.join(fixture.repo, "other.txt"), "earlier session\n");
  git(fixture.repo, ["add", "other.txt"]);
  git(fixture.repo, ["commit", "-m", "test: other session"]);
  const parent = git(fixture.repo, ["rev-parse", "HEAD"]);
  write(path.join(fixture.repo, "owned.txt"), "this session\n");

  const later = run(fixture.repo, ["--mode", "commit-push", "--message", "test: own session", "--path", "owned.txt"]);
  assert.equal(later.status, 3, later.stdout);
  assert.equal(later.json.code, "parent_not_published");
  assert.equal(later.json.parent, parent);
  assert.equal(git(fixture.repo, ["show", "--pretty=", "--name-only", later.json.sha]), "owned.txt");
  assert.equal(git(fixture.repo, ["ls-remote", "origin", "refs/heads/main"]).split(/\s+/)[0], originalRemote);

  const publishParent = run(fixture.repo, ["--mode", "push-commit", "--commit", parent, "--path", "other.txt"]);
  assert.equal(publishParent.status, 0, publishParent.stdout);
  assert.equal(git(fixture.repo, ["ls-remote", "origin", "refs/heads/main"]).split(/\s+/)[0], parent);
  const publishLater = run(fixture.repo, ["--mode", "push-commit", "--commit", later.json.sha, "--path", "owned.txt"]);
  assert.equal(publishLater.status, 0, publishLater.stdout);
  assert.equal(git(fixture.repo, ["ls-remote", "origin", "refs/heads/main"]).split(/\s+/)[0], later.json.sha);
});

test("two simultaneous closeouts publish their own files and preserve a third staged file", { timeout: 60000 }, async (t) => {
  const fixture = createRepository();
  t.after(() => cleanupFixture(fixture));
  write(path.join(fixture.repo, "owned.txt"), "session A\n");
  write(path.join(fixture.repo, "other.txt"), "session B\n");
  write(path.join(fixture.repo, "staged.txt"), "third session staged\n");
  git(fixture.repo, ["add", "staged.txt"]);
  const common = ["--mode", "commit-push", "--wait-seconds", "20"];

  const [a, b] = await Promise.all([
    runAsync(fixture.repo, [...common, "--message", "test: session A", "--path", "owned.txt"]),
    runAsync(fixture.repo, [...common, "--message", "test: session B", "--path", "other.txt"]),
  ]);

  assert.equal(a.status, 0, a.stdout + a.stderr);
  assert.equal(b.status, 0, b.stdout + b.stderr);
  assert.notEqual(a.json.sha, b.json.sha);
  assert.equal(git(fixture.repo, ["show", "--pretty=", "--name-only", a.json.sha]), "owned.txt");
  assert.equal(git(fixture.repo, ["show", "--pretty=", "--name-only", b.json.sha]), "other.txt");
  assert.equal(git(fixture.repo, ["diff", "--cached", "--name-only"]), "staged.txt");
  assert.equal(git(fixture.repo, ["show", ":staged.txt"]), "third session staged");
  const remote = git(fixture.repo, ["ls-remote", "origin", "refs/heads/main"]).split(/\s+/)[0];
  assert.equal(git(fixture.repo, ["merge-base", "--is-ancestor", a.json.sha, remote]), "");
  assert.equal(git(fixture.repo, ["merge-base", "--is-ancestor", b.json.sha, remote]), "");
});

test("waits briefly for a busy Git index without deleting its lock", { timeout: 30000 }, async (t) => {
  const fixture = createRepository();
  t.after(() => cleanupFixture(fixture));
  write(path.join(fixture.repo, "owned.txt"), "verified change\n");
  const lock = path.join(fixture.repo, ".git/index.lock");
  fs.writeFileSync(lock, "other writer");
  const timer = setTimeout(() => {
    if (fs.existsSync(lock) && fs.readFileSync(lock, "utf8") === "other writer") fs.unlinkSync(lock);
  }, 5000);
  try {
    const result = await runAsync(fixture.repo, ["--mode", "commit-push", "--message", "test: wait", "--wait-seconds", "15", "--path", "owned.txt"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.json.status, "pushed");
  } finally {
    clearTimeout(timer);
  }
});

test("refuses to resume a commit containing an undeclared file", (t) => {
  const fixture = createRepository();
  t.after(() => cleanupFixture(fixture));
  write(path.join(fixture.repo, "owned.txt"), "owned\n");
  write(path.join(fixture.repo, "other.txt"), "unrelated\n");
  git(fixture.repo, ["add", "owned.txt", "other.txt"]);
  git(fixture.repo, ["commit", "-m", "test: mixed"]);
  const sha = git(fixture.repo, ["rev-parse", "HEAD"]);

  const result = run(fixture.repo, ["--mode", "push-commit", "--commit", sha, "--path", "owned.txt"]);
  assert.equal(result.status, 2, result.stdout);
  assert.equal(result.json.code, "commit_scope_mismatch");
  assert.notEqual(git(fixture.repo, ["ls-remote", "origin", "refs/heads/main"]).split(/\s+/)[0], sha);
});

test("rejects ignored paths and treats path names literally", (t) => {
  const fixture = createRepository();
  t.after(() => cleanupFixture(fixture));
  write(path.join(fixture.repo, ".git/info/exclude"), "ignored.txt\n");
  write(path.join(fixture.repo, "ignored.txt"), "excluded\n");
  write(path.join(fixture.repo, "owned.txt"), "changed\n");

  const ignored = run(fixture.repo, ["--mode", "check", "--path", "ignored.txt"]);
  const glob = run(fixture.repo, ["--mode", "check", "--path", "*.txt"]);
  assert.equal(ignored.json.code, "ignored_path");
  assert.equal(glob.json.code, "path_not_found");
  assert.equal(git(fixture.repo, ["diff", "--cached", "--name-only"]), "");
});

test("rejects remote-ahead history before staging", (t) => {
  const fixture = createRepository();
  t.after(() => cleanupFixture(fixture));
  const peer = path.join(fixture.root, "peer");
  git(fixture.root, ["clone", "-b", "main", fixture.remote, peer]);
  git(peer, ["config", "user.name", "Peer"]);
  git(peer, ["config", "user.email", "peer@example.invalid"]);
  write(path.join(peer, "peer.txt"), "remote change\n");
  git(peer, ["add", "peer.txt"]);
  git(peer, ["commit", "-m", "peer change"]);
  git(peer, ["push", "origin", "main"]);
  write(path.join(fixture.repo, "owned.txt"), "local change\n");

  const result = run(fixture.repo, ["--mode", "commit-push", "--message", "test: blocked", "--path", "owned.txt"]);

  assert.equal(result.status, 2);
  assert.equal(result.json.code, "history_not_synchronized");
  assert.equal(result.json.behind, 1);
  assert.equal(git(fixture.repo, ["diff", "--cached", "--name-only"]), "");
});

test("rejects directories and common secret paths", (t) => {
  const fixture = createRepository();
  t.after(() => cleanupFixture(fixture));
  write(path.join(fixture.repo, ".env"), "TOKEN=secret\n");

  const directory = run(fixture.repo, ["--mode", "check", "--path", "."]);
  const secret = run(fixture.repo, ["--mode", "check", "--path", ".env"]);

  assert.equal(directory.status, 2);
  assert.equal(directory.json.code, "unsafe_path");
  assert.equal(secret.status, 2);
  assert.equal(secret.json.code, "unsafe_path");
});

test("redacts credentials and token query values from Git failures", (t) => {
  const fixture = createRepository();
  t.after(() => cleanupFixture(fixture));
  write(path.join(fixture.repo, "owned.txt"), "changed\n");
  const redactionUrl = new URL("https://127.0.0.1:1/repo.git");
  redactionUrl.username = "user";
  redactionUrl.password = "secret";
  redactionUrl.searchParams.set("token", "dummy-token");
  git(fixture.repo, ["remote", "set-url", "origin", redactionUrl.href]);

  const result = run(fixture.repo, ["--mode", "check", "--path", "owned.txt"]);

  assert.equal(result.status, 2);
  assert.equal(result.json.code, "git_command_failed");
  assert.doesNotMatch(result.stdout, /secret|dummy-token/);
  assert.match(result.stdout, /\[redacted\]/);
});
