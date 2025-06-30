Please review this pull request and provide comprehensive feedback.

Keep following things in mind:

- author name in package.json file should be step-security
- If there is a field named git repository in package.json file then it should contain the phrase step-security. If the field repository is not present then ignore.
- There should be a action.yml file and in that as well author name should be step-security. If the field author-name is not present then ignore.
- MIT or Apache 2.0 license should be present with copyright of step-security as well as original author.
- None of the dependencies should be unused.
- Security.md file should be present.
- renovate.json file should not be present.
- FUNDING.yml or funding.yml file should not be present.
- PULL_REQUEST.md file should not be present.
- ISSUE_TEMEPLATE folder should not be present.
- CHANGELOG.md file should not be present.
- Code should contain subscription check and make sure it makes call to this url "https://agent.api.stepsecurity.io/v1/github/$GITHUB_REPOSITORY/actions/subscription" for checking the subscription.
- dist folder should be present.
- .github folder should contain workflows folder and this folder should contain following files
   - auto_cherry_pick.yml
   - guarddog.yml
   - actions_release.yml
   - audit_package.yml
   - claude_review.yml
- If package.json does not contain the field "build" in the scripts object or the package manager is not npm then check the files .github/workflows/audt_fix.yml and .github/workflows/actions_release.yml, they should contain script as an input.
- .vscode folder should not be present
- If Readme.md file contains any part which tells how the action should be used, then make sure that in the example complete semver tag is not used and only major version is used.
- Scan the whole code thoroughly for any existing security vulnerabilities that might be exploited by malicious actors.
