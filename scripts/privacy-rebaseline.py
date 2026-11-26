#!/usr/bin/env python3
"""One-time current-source rebaseline. No private history in logs or artifacts."""
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import urllib.request

IDENTITY = {
    "GIT_AUTHOR_NAME": "github-actions[bot]",
    "GIT_COMMITTER_NAME": "github-actions[bot]",
    "GIT_AUTHOR_EMAIL": "41898282+github-actions[bot]@users.noreply.github.com",
    "GIT_COMMITTER_EMAIL": "41898282+github-actions[bot]@users.noreply.github.com",
}
MAIN = "refs/heads/main"

def need(ok, message):
    if not ok:
        raise RuntimeError(message)

def git(*args, data=None, env=None, cwd=None, allow=False):
    p = subprocess.run(["git", *args], input=data, stdout=subprocess.PIPE,
                       stderr=subprocess.PIPE, cwd=cwd,
                       env={**os.environ, **(env or {})})
    if p.returncode and not allow:
        # Never echo historical patches, ref names, credentials or raw remote errors.
        raise RuntimeError("Git operation failed: " + args[0])
    return p.stdout if not p.returncode else None

def val(*args, **kw):
    return git(*args, **kw).decode().strip()

def remote_refs(cwd=None):
    lines = val("ls-remote", "--refs", "origin", cwd=cwd).splitlines()
    refs = {}
    pull_count = 0
    for line in lines:
        sha, ref = line.split("\t", 1)
        if ref.startswith(("refs/heads/", "refs/tags/")):
            refs[ref] = sha
        elif ref.startswith("refs/pull/"):
            pull_count += 1
        else:
            raise RuntimeError("Unexpected remote reference type; stop for review")
    need(MAIN in refs, "Missing main")
    return refs, pull_count

def api(path, key=None):
    repo = os.environ["GITHUB_REPOSITORY"]
    token = os.environ["GH_TOKEN"]
    result = []
    page = 1
    while True:
        sep = "&" if "?" in path else "?"
        url = "https://api.github.com/repos/" + repo + "/" + path + sep + "per_page=100&page=" + str(page)
        req = urllib.request.Request(url, headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "privacy-rebaseline",
        })
        with urllib.request.urlopen(req, timeout=20) as response:
            obj = json.load(response)
        rows = obj[key] if key else obj
        result.extend(rows)
        if len(rows) < 100:
            return result
        page += 1

def open_prs(refs):
    repo = os.environ["GITHUB_REPOSITORY"]
    result = []
    for pr in api("pulls?state=open"):
        need(pr["base"]["ref"] == "main", "Open PR has a different base")
        need(pr["head"]["repo"] and pr["head"]["repo"]["full_name"] == repo,
             "Open PR from another repository; preserve separately first")
        ref = "refs/heads/" + pr["head"]["ref"]
        need(ref != MAIN and refs.get(ref) == pr["head"]["sha"],
             "Open PR changed during preflight")
        result.append((pr["number"], ref, refs[ref]))
    need(len({p[1] for p in result}) == len(result), "Duplicate open PR heads")
    return sorted(result)

def plan_digest(refs, prs):
    return hashlib.sha256(json.dumps([sorted(refs.items()), prs],
                                    separators=(",", ":")).encode()).hexdigest()

def build_plan(refs, prs, cwd=None):
    main = refs[MAIN]
    tree = val("rev-parse", main + "^{tree}", cwd=cwd)
    stamp = val("show", "-s", "--format=%cI", main, cwd=cwd)
    identity = {**IDENTITY, "GIT_AUTHOR_DATE": stamp, "GIT_COMMITTER_DATE": stamp}
    root = val("commit-tree", tree, "-m", "Privacy-safe current-source baseline",
               env=identity, cwd=cwd)
    need(val("rev-list", "--count", root, cwd=cwd) == "1", "Root contains history")
    need(val("rev-parse", root + "^{tree}", cwd=cwd) == tree, "Root tree mismatch")
    target = {MAIN: root}
    for number, ref, head in prs:
        base = val("merge-base", main, head, cwd=cwd)
        diff = git("diff", "--binary", "--no-renames", "--no-ext-diff", base, head, cwd=cwd)
        with tempfile.TemporaryDirectory() as td:
            idx = {"GIT_INDEX_FILE": str(pathlib.Path(td) / "index")}
            git("read-tree", root, env=idx, cwd=cwd)
            if diff:
                # Strict cached apply. No automatic conflict resolution.
                git("apply", "--cached", "--binary", "-", data=diff, env=idx, cwd=cwd)
            pr_tree = val("write-tree", env=idx, cwd=cwd)
        if pr_tree == tree:
            new_head = root
        else:
            new_head = val("commit-tree", pr_tree, "-p", root, "-m",
                           "Preserve pending reviewed change", env=identity, cwd=cwd)
        new_diff = git("diff", "--binary", "--no-renames", "--no-ext-diff",
                       root, new_head, cwd=cwd)
        need(new_diff == diff, "Pending PR patch is not exactly preserved; stop")
        target[ref] = new_head
    return target, tree

def push_plan(refs, target, cwd=None):
    # All writable refs, including obsolete branches and tags, change atomically.
    # Every old tip has a lease. No public backup ref retains the old history.
    args = ["push", "--atomic"]
    for ref, old in sorted(refs.items()):
        args.append("--force-with-lease=" + ref + ":" + old)
    args.append("origin")
    for ref in sorted(refs):
        args.append((target[ref] if ref in target else "") + ":" + ref)
    git(*args, cwd=cwd)
    observed, pull_count = remote_refs(cwd)
    need(observed == target, "Post-push ref readback mismatch; do not mark complete")
    return pull_count

def require_checks(main):
    required = ({"regression-checks", "staged-endpoint"}
                if os.environ["GITHUB_REPOSITORY"].endswith("/lexi-spend")
                else {"list-loading"})
    runs = api("commits/" + main + "/check-runs?filter=latest", "check_runs")
    for name in required:
        matching = [r for r in runs if r["name"] == name and r["head_sha"] == main]
        need(bool(matching), "Missing required check on exact main")
        run = max(matching, key=lambda x: x["id"])
        need(run["status"] == "completed" and run["conclusion"] == "success",
             "Required check has not passed on exact main")

def execute():
    need(os.environ.get("GITHUB_ACTOR") == os.environ.get("GITHUB_REPOSITORY_OWNER"),
         "Only repository owner may dispatch")
    need(os.environ.get("GITHUB_REF") == MAIN, "Dispatch main only")
    mode = os.environ["MODE"]
    need(mode in {"plan", "apply"}, "Unknown mode")
    refs, pull_count = remote_refs()
    main = refs[MAIN]
    need(main == val("rev-parse", "HEAD"), "Main moved after checkout")
    require_checks(main)
    prs = open_prs(refs)
    target, tree = build_plan(refs, prs)
    digest = plan_digest(refs, prs)
    print("Current main:", main)
    print("Approved source tree:", tree)
    print("Proposed clean root:", target[MAIN])
    print("Writable refs:", len(refs), "pending PRs preserved:", [p[0] for p in prs])
    print("Obsolete branches/tags to remove:", len(refs) - len(target))
    print("Server-managed PR refs (separate Support cleanup):", pull_count)
    print("PLAN DIGEST:", digest)
    if mode == "plan":
        print("PLAN ONLY: nothing pushed")
        return
    need(os.environ.get("CONFIRM") == "REWRITE", "Confirmation must equal REWRITE")
    need(os.environ.get("EXPECTED_MAIN") == main, "Approved main changed")
    need(os.environ.get("EXPECTED_PLAN") == digest, "Approved ref/PR inventory changed")
    rulesets = api("rulesets")
    need(bool(rulesets) and all(r["enforcement"] == "disabled" for r in rulesets),
         "Disable ruleset immediately before apply; do not bypass")
    refs_again, _ = remote_refs()
    need(refs_again == refs and open_prs(refs_again) == prs,
         "References changed since plan; do not push")
    remaining_pull = push_plan(refs, target)
    print("REWRITE VERIFIED: exact source tree retained, main has one parentless commit")
    print("NEW MAIN:", target[MAIN])
    print("Remaining server-managed PR refs:", remaining_pull)
    print("Restore ruleset to Active immediately. Full historical purge is separate.")

def self_test():
    with tempfile.TemporaryDirectory() as td:
        remote = pathlib.Path(td) / "remote.git"
        work = pathlib.Path(td) / "work"
        git("init", "--bare", "--initial-branch=main", str(remote))
        git("init", "--initial-branch=main", str(work))
        git("config", "user.name", "Test", cwd=work)
        git("config", "user.email", "test@example.com", cwd=work)
        (work / "old.txt").write_text("synthetic historical marker")
        git("add", ".", cwd=work)
        git("commit", "-m", "old", cwd=work)
        old = val("rev-parse", "HEAD", cwd=work)
        git("branch", "obsolete", cwd=work)
        git("tag", "obsolete-tag", cwd=work)
        git("rm", "old.txt", cwd=work)
        (work / "app.txt").write_text("clean source")
        git("add", ".", cwd=work)
        git("commit", "-m", "clean", cwd=work)
        git("switch", "-c", "pending", cwd=work)
        (work / "pending.txt").write_text("pending change")
        git("add", ".", cwd=work)
        git("commit", "-m", "pending", cwd=work)
        git("switch", "main", cwd=work)
        git("remote", "add", "origin", str(remote), cwd=work)
        git("push", "--all", "origin", cwd=work)
        git("push", "--tags", "origin", cwd=work)
        refs, _ = remote_refs(work)
        prs = [(1, "refs/heads/pending", refs["refs/heads/pending"])]
        target, tree = build_plan(refs, prs, work)
        need(target == build_plan(refs, prs, work)[0], "Plan not deterministic")
        need(plan_digest(refs, prs) != plan_digest({**refs, MAIN: old}, prs),
             "Digest failed to bind ref inventory")
        # A stale lease must fail atomically without changing any writable refs.
        stale = {**refs, "refs/heads/obsolete": refs[MAIN]}
        try:
            push_plan(stale, target, work)
        except RuntimeError:
            pass
        else:
            raise RuntimeError("Stale lease unexpectedly succeeded")
        need(remote_refs(work)[0] == refs, "Atomic stale-lease test failed")
        push_plan(refs, target, work)
        need(remote_refs(work)[0] == target, "Ref readback failed")
        need(val("rev-parse", target[MAIN] + "^{tree}", cwd=work) == tree, "Source changed")
        need(val("rev-list", "--count", target[MAIN], cwd=work) == "1", "History remains")
        need(old not in val("rev-list", *target.values(), cwd=work).splitlines(),
             "Old commit still reachable through writable refs")
        need(val("show", target["refs/heads/pending"] + ":pending.txt", cwd=work)
             == "pending change", "Pending PR lost")
        print("PASS: deterministic root, exact source, pending PR, digest, atomic stale lease, ref cleanup")

if __name__ == "__main__":
    try:
        self_test() if "--self-test" in sys.argv else execute()
    except Exception as exc:
        # RuntimeError messages above are deliberately non-sensitive; other
        # exceptions may include paths or remote data, so only report type.
        print("STOP:", str(exc) if isinstance(exc, RuntimeError) else type(exc).__name__)
        sys.exit(1)
