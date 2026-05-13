# Screenshot artifacts

Runtime screenshots are intentionally excluded from git because binary image diffs are not supported in the review workflow.

To regenerate local audit screenshots:

```bash
RAE_ALLOW_FIXTURES=true npm run dev
# In another shell, run the Playwright/browser capture workflow documented in FINAL_AUDIT.md.
```

Expected local output paths:

- `artifacts/screenshots/rae-desktop.png`
- `artifacts/screenshots/rae-mobile.png`

Only this text manifest should be committed.
