# Salesforce CLI (sf / sfdx) Cheat Sheet & Quick Reference

This document provides a clean, structured reference guide for Salesforce CLI (`sf` / `sfdx`) commands, categorized logically by feature domain, alongside complementary code snippets for Prettier, Git, MCP, and Python Asyncio.

---

## 1. Salesforce CLI (`sf` / `sfdx`) Reference

### 1.1 Organization & Session Management
Commands for listing, authenticating, configuring defaults, and managing session access to Salesforce orgs.

#### Org Listing & Information
- **List all connected orgs:**
  ```bash
  sf org list
  ```
- **List orgs with authorization details:**
  ```bash
  sf org list auth
  ```
- **Display active user information:**
  ```bash
  sf org display
  ```
- **Check org governor limits:**
  ```bash
  # Check limits on default org
  sf org list limits

  # Check limits on a specific org
  sf org list limits --target-org my-org-alias
  ```
- **Get approximate SObject record counts:**
  ```bash
  # Specific objects
  sf org list sobject record-counts --sobject Account --sobject Lead --target-org my-scratch-org

  # All SObjects (omit --sobject flag)
  sf org list sobject record-counts --target-org my-scratch-org
  ```

#### Authentication & Web Login
- **Log in via web browser:**
  ```bash
  sf org login web --set-default-dev-hub --alias my-hub-org
  ```
- **Log in using an access token / Session ID:**
  ```bash
  # Interactive prompt
  sf org login access-token --instance-url https://mycompany.my.salesforce.com --alias myAlias

  # Non-interactive (requires SF_ACCESS_TOKEN environment variable)
  export SF_ACCESS_TOKEN='your_session_id_here'
  sf org login access-token --instance-url https://dev-hub.my.salesforce.com --no-prompt
  ```
  *Key flags for login commands:*
  - `-s` : Set as default org
  - `-a <alias>` : Define an alias for the org
  - `-d` : Set as default Dev Hub

- **Display authentication tokens/URLs:**
  ```bash
  # Display session token
  sf org auth show-session-token -o target-org_alias

  # Display SFDX auth URL
  sf org auth show-sfdx-auth-url -o target-org_alias
  ```

#### Configuration & Target Setup
- **Set default target org or Dev Hub:**
  ```bash
  sf config set target-dev-hub jdoe@mydevhub.com --global
  sf config set target-org test-wvkpnfm5z113@example.com --global
  ```
- **Unset default configuration values:**
  ```bash
  sf config unset target-org --global
  sf config unset target-dev-hub
  ```
- **List configuration settings:**
  ```bash
  sf config list
  ```

#### Log Out
- **Log out from active orgs:**
  ```bash
  # Interactive logout
  sf org logout

  # Target specific org
  sf org logout --target-org me@my.org
  sf org logout -o myOrgAlias

  # Log out from all orgs
  sf org logout --all
  ```

---

### 1.2 Alias Management
Manage local aliases mapped to Salesforce orgs and instances.

- **List all current aliases:**
  ```bash
  sf alias list
  ```
- **Set or update aliases:**
  ```bash
  sf alias set my-org-alias=my-org.sandbox.url my-org-alias2=my-org.sandbox.url2
  ```
- **Unset/remove aliases:**
  ```bash
  sf alias unset alias1 alias2
  ```

---

### 1.3 Project Setup & Metadata Discovery
Commands to initialize local Salesforce projects, generate manifests, and explore org metadata.

#### Project Initialization & Manifests
- **Generate a new project with a manifest:**
  ```bash
  sf project generate --name mywork --default-package-dir myapp --manifest
  ```
- **Generate a manifest (`package.xml`) directly from an org:**
  ```bash
  sf project generate manifest --from-org <org_alias> --output-dir <output_directory>
  ```

#### Metadata Listing & Discovery
- **List available metadata types:**
  ```bash
  sf org list metadata-types --api-version 57.0 --target-org my-dev-org --output-file /path/to/outputFile
  ```
- **List specific metadata components (e.g., Custom Objects):**
  ```bash
  sf org list metadata --metadata-type CustomObject --target-org my-dev-org
  ```
- **Save metadata listing results to a file:**
  ```bash
  sf org list metadata --metadata-type CustomObject --api-version 62.0 --output-file /path/to/outputfilename.txt
  ```

---

### 1.4 Source Retrieval (`sf project retrieve`)
Commands to pull source components and metadata from a target org into your local workspace.

- **Retrieve all project changes:**
  ```bash
  sf project retrieve start
  ```
- **Retrieve preview (check changes without downloading):**
  ```bash
  sf project retrieve preview --ignore-conflicts --target-org my-scratch
  ```
- **Retrieve by directory:**
  ```bash
  sf project retrieve start --source-dir force-app/main/default/classes force-app/main/default/objects
  ```
- **Retrieve by metadata type or specific component:**
  ```bash
  # Retrieve all components of a type
  sf project retrieve start --metadata ApexClass CustomObject

  # Retrieve specific individual files/components
  sf project retrieve start --metadata ApexClass:MyApexClass --ignore-conflicts
  sf project retrieve start --metadata CustomObject:SBQQ__ExcitingObject

  # Retrieve using wildcards/regex matching
  sf project retrieve start --metadata 'ApexClass:MyApex*'
  sf project retrieve start --metadata 'CustomObject:SBQQ__*'
  ```
- **Retrieve using a manifest (`package.xml`):**
  ```bash
  sf project retrieve start --manifest path/to/package.xml
  ```
- **Retrieve from installed packages:**
  ```bash
  sf project retrieve start --package-name Package1 "PackageName With Spaces" Package3
  ```
- **Retrieve using legacy SFDX commands (deprecated):**
  ```bash
  sfdx force:source:retrieve -x path/to/package.xml
  sfdx force:source:retrieve -m CustomObject,ApexClass
  sfdx force:source:retrieve -m ApexClass:MyClass
  ```

---

### 1.5 Project Deployment & Validation (`sf project deploy`)
Commands to validate and deploy code and metadata to Salesforce environments.

#### Deployment Validation
- **Validate deployment without applying changes:**
  ```bash
  sf project deploy validate --metadata CustomObject:Case
  sf project deploy validate --manifest path/to/package.xml
  sf project deploy validate --source-dir force-app --async --test-level RunAllTestsInOrg --target-org my-prod-org
  ```
- **Validate with destructive changes (pre/post scripts):**
  ```bash
  sf project deploy validate --metadata CustomObject:Account --pre-destructive-changes path/to/destructiveChangesPre.xml --post-destructive-changes path/to/destructiveChangesPost.xml
  ```

#### Deploy Preview & Execution
- **Preview changes before deployment:**
  ```bash
  sf project deploy preview --manifest path/to/package.xml
  sf project deploy preview --metadata ApexClass:MyApexClass
  ```
- **Deploy local changes:**
  ```bash
  # Deploy all local changes
  sf project deploy start

  # Deploy specific directories
  sf project deploy start --source-dir force-app/main/default/classes force-app/main/default/objects

  # Deploy with test execution
  sf project deploy start --metadata ApexClass --test-level RunLocalTests

  # Deploy using manifest file
  sf project deploy start --manifest path/to/package.xml

  # Check-only deployment (validation)
  sf project deploy start --target-org MyDevOrg --check-only
  ```
- **Quick Deploy (deploy previously validated packages):**
  ```bash
  sf project deploy quick --job-id 0Af0x000017yLUFCA2
  sf project deploy quick --async --use-most-recent --target-org my-prod-org
  ```
- **Deploy Monitoring & Cancellation:**
  ```bash
  # Check status of asynchronous deployments/validations
  sf project deploy report

  # Resume watching deployment progress
  sf project deploy resume

  # Cancel an active deployment job
  sf project deploy cancel --job-id 0Af0x000017yLUFCA2
  sf project deploy cancel --use-most-recent
  ```
- **Deploy using legacy SFDX commands (deprecated):**
  ```bash
  sfdx force:source:deploy -x path/to/package.xml
  sfdx force:source:deploy -m ApexClass:MyApexClass
  ```

---

### 1.6 Source Deletion & Cleanup
Commands for removing metadata and cleaning org configurations.

- **Delete components from non-source-tracked orgs:**
  ```bash
  sf project delete source --metadata ApexClass:MyFabulousApexClass --metadata "Profile: My Profile" --no-prompt
  ```
- **Remove deleted items from source-tracked orgs:**
  ```bash
  sf project xml start
  ```

---

### 1.7 Schema Generation
CLI scaffolding tools for creating custom fields, objects, tabs, and platform events.

- **Generate Custom Field:**
  ```bash
  # Interactive mode
  sf schema generate field --label "My Field"

  # Explicit object declaration
  sf schema generate field --label "My Field" --object force-app/main/default/objects/MyObject__c
  ```
- **Generate Custom Object (SObject):**
  ```bash
  # Interactive mode
  sf schema generate sobject --label "My Object"

  # Non-interactive mode (default options)
  sf schema generate sobject --label "My Object" --use-default-features
  ```
- **Generate Tab:**
  ```bash
  sf schema generate tab --object MyObject__c --icon 54 --directory force-app/main/default/tabs
  ```
- **Generate Platform Event:**
  ```bash
  sf schema generate platformevent --label "My Platform Event"
  ```

---

### 1.8 Apex Execution, Logs & Testing
Commands to manage Apex logs, run anonymous Apex code, and execute unit tests.

#### Log Management
- **List logs in the target org:**
  ```bash
  sf apex list log --target-org alias
  ```
- **Fetch specific log by ID:**
  ```bash
  sf apex get log --log-id <log-id> --target-org myUser@myOrg/alias
  ```
- **Fetch most recent logs:**
  ```bash
  sf apex get log --output-dir MyLogs/logs --number 2
  ```
- **Tail logs in real-time:**
  ```bash
  sf apex tail log --debug-level MyDebugLevel --color
  ```

#### Anonymous Apex Execution
- **Run anonymous Apex script from file:**
  ```bash
  sf apex run --target-org Alias --file ./mytest.apex
  ```

#### Apex Testing & Test Suites
- **Run tests by class names:**
  ```bash
  sf apex run test --class-names MyClassTest --class-names MyOtherClassTest --result-format human
  ```
- **Run specific test methods:**
  ```bash
  sf apex run test --tests MyClassTest.testCoolFeature --tests MyClassTest.testAwesomeFeature --tests AnotherClassTest --tests namespace.TheirClassTest.testThis --result-format human
  ```
- **Run test suites with code coverage:**
  ```bash
  sf apex run test --test-level RunLocalTests --suite-names MySuite --suite-names MyOtherSuite --code-coverage --detailed-coverage
  ```
- **Get test run results by Job ID:**
  ```bash
  sf apex get test -i 707WK00000W6Wpq -o OrgAlias
  ```
  *(Note: You can also monitor test status in Salesforce Setup under **Apex Test Execution**).*

---

## 2. Additional Development Tools & Utilities

### 2.1 Code Formatting (Prettier Setup for Salesforce)
To install and set up Prettier for LWC, Apex, and XML formatting:

1. **Install dependencies:**
   ```bash
   npm install --save-dev prettier prettier-plugin-apex @prettier/plugin-xml
   ```

2. **Create `.prettierrc` configuration file:**
   ```json
   {
     "trailingComma": "none",
     "printWidth": 120,
     "tabWidth": 4,
     "singleQuote": true,
     "semi": true,
     "apexInsertFinalNewline": true,
     "plugins": ["prettier-plugin-apex", "@prettier/plugin-xml"]
   }
   ```

3. **Format project files:**
   ```bash
   npx prettier --write "force-app/**/*.{cls,trigger,js,html,xml}"
   ```

---

### 2.2 Git Workflow Utility
- **Commit changes without triggering git hooks or linters (e.g., ESLint):**
  ```bash
  git commit --no-verify -m "COMMIT MESSAGE"
  ```

---

### 2.3 Model Context Protocol (MCP) Debugging
- **Debug an MCP server script using the inspector:**
  ```bash
  npx @modelcontextprotocol/inspector py your_script.py
  ```

---

### 2.4 Python Async Execution
- **Execute asynchronous functions in Python using `asyncio`:**
  ```python
  import asyncio

  async def main():
      print("Running async task...")

  if __name__ == "__main__":
      asyncio.run(main())
  ```

---

## 3. External Resources & Guides
- [Deploying Full Salesforce Profiles using SFDX](https://benahm0.medium.com/deploy-a-full-salesforce-%EF%B8%8F-profile-using-sfdx-85c94dc8a679)
