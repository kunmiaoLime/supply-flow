# Create or Update a Graphite Pull Request

Use this procedure only when the primary pull-request workflow determines that
the selected repository has a valid `.graphite_repo_config`. Graphite is
required for this path. Do not use `gh pr create`, `gh pr edit`, direct
`git push`, or GitHub CLI authentication to create or update the pull request.

The selected branch already contains the committed work to review. Do not edit
source files, create or amend commits, or recreate the selected branch while
following this procedure.

1. Work from the selected repository and confirm the branch is safe to submit:

   ```sh
   cd <REPOSITORY_LOCAL>
   git status --short
   git branch --show-current
   gt log short
   ```

   The current branch must be `<BRANCH_NAME>`, and `gt log short` must show the
   intended parent-child chain. If the worktree is unsafe, the branch is wrong,
   Graphite is unavailable, or the stack relationship is missing or unclear,
   stop and report the blocker. Do not fall back to GitHub CLI submission.

2. A Graphite child branch must be created from its intended parent during the
   implementation workflow:

   ```sh
   git switch <PARENT_BRANCH>
   git status --short
   gt create <CHILD_BRANCH>
   ```

   `gt create` establishes the stack relationship. Do not run it during this
   pull-request workflow for an already selected branch. If the selected branch
   was not created through Graphite, stop and report that it needs to be
   reconciled before submission.

3. For a new Graphite pull request, reconcile the stack and submit it through
   Graphite:

   ```sh
   gt restack --downstack --branch <BRANCH_NAME> --no-interactive
   gt submit --stack --always --restack --branch <BRANCH_NAME> --no-interactive
   ```

4. When updating an existing Graphite pull request, do not create a duplicate:

   ```sh
   gt submit --update-only --no-edit --stack --always --restack \
     --branch <BRANCH_NAME> --no-interactive
   ```

5. `gt submit` uses the machine's Graphite authentication, not `gh`
   authentication. Add an environment workaround such as
   `NODE_TLS_REJECT_UNAUTHORIZED=0` only when that specific machine requires
   it. Do not add it preemptively.

6. Confirm the resulting pull-request URL from Graphite and GitHub before
   returning to the primary workflow to track the pull request.
