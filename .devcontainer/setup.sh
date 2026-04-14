#!/bin/bash
# Note: intentionally no `set -e` — optional tools (Render CLI) may fail without aborting setup
set -uo pipefail

echo "╔══════════════════════════════════════════════╗"
echo "║       CBLAeroApp Codespace Setup             ║"
echo "╚══════════════════════════════════════════════╝"

# ── 1. Node dependencies ────────────────────────────
echo ""
echo "▶ Installing npm dependencies..."
npm install

# ── 2. Supabase CLI ─────────────────────────────────
echo ""
echo "▶ Installing Supabase CLI (binary)..."
curl -sSL https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.tar.gz -o /tmp/sb.tar.gz \
  && tar xf /tmp/sb.tar.gz -C /tmp \
  && sudo mv /tmp/supabase /usr/local/bin/ \
  && echo "  ✓ Supabase $(supabase --version)" \
  || echo "  ℹ Supabase CLI install failed – retry manually"
  && echo "  done Supabase $(supabase --version)" \
  || echo "  i Supabase CLI install failed – retry manually"

# ── 3. Render CLI ───────────────────────────────────
echo ""
echo "▶ Installing Render CLI (optional — failure does not abort setup)..."
(npm install -g @render-oss/cli --loglevel=error 2>/dev/null || \
  curl -fsSL https://render.com/install-cli.sh | bash 2>/dev/null || \
  echo "  i Render CLI skipped – install manually if needed") || true

# ── 4. BMAD Method – all modules ────────────────────
echo ""
echo "▶ Installing BMAD Method (all modules)..."
npx bmad-method install \
  --yes \
  --tools claude-code \
  --modules bmm,bmb,cis,gds,tea \
  --user-name "Vivek" \
  --output-folder _bmad-output

echo ""
echo "▶ BMAD status:"
npx bmad-method status

# ── 5. Git config ────────────────────────────────────
echo ""
echo "▶ Configuring git defaults..."
git config --global pull.rebase false
git config --global init.defaultBranch main

# ── 6. .env.local scaffold ──────────────────────────
if [ ! -f ".env.local" ]; then
  echo ""
  echo "▶ Creating .env.local scaffold..."
  cat > .env.local << 'ENVEOF'
# ── App ───────────────────────────────────────────────
CBL_SESSION_SECRET=
CBL_APP_URL=http://localhost:3000

# ── Supabase ──────────────────────────────────────────
CBL_SUPABASE_URL=
CBL_SUPABASE_SERVICE_ROLE_KEY=
CBL_SUPABASE_SCHEMA=cblaero_app

# ── Microsoft Entra SSO ───────────────────────────────
CBL_SSO_ISSUER=
CBL_SSO_CLIENT_ID=
CBL_SSO_CLIENT_SECRET=
CBL_SSO_ALLOWED_EMAIL_DOMAIN=cblsolutions.com
CBL_SSO_ALLOWED_TENANT_ID=

# ── Data Residency ────────────────────────────────────
CBL_APPROVED_US_REGIONS=us-east-1,us-west-2
CBL_DATA_REGION=us-west-2
CBL_LOG_REGION=us-west-2
CBL_BACKUP_REGION=us-west-2

# ── Anthropic ─────────────────────────────────────────
ANTHROPIC_API_KEY=
ENVEOF
  echo "  done .env.local created – fill in your keys"
fi

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Setup complete!                             ║"
echo "║                                              ║"
echo "║  Next steps:                                 ║"
echo "║  1. Fill in .env.local with your keys        ║"
echo "║  2. Run: npm run dev                         ║"
echo "║  3. Sign in to GitHub Copilot in VS Code     ║"
echo "╚══════════════════════════════════════════════╝"

# ── Restore CBLAeroApp BMAD customizations ───────────
echo ""
echo "▶ Restoring CBLAeroApp workflow customizations..."
OVERRIDES_DIR=".devcontainer/bmad-overrides"
if [ -d "$OVERRIDES_DIR" ]; then
  cp "$OVERRIDES_DIR/4-implementation/dev-story/workflow.yaml"    _bmad/bmm/4-implementation/dev-story/workflow.yaml
  cp "$OVERRIDES_DIR/4-implementation/create-story/workflow.yaml" _bmad/bmm/4-implementation/create-story/workflow.yaml
  cp "$OVERRIDES_DIR/4-implementation/code-review/workflow.yaml"  _bmad/bmm/4-implementation/code-review/workflow.yaml
  cp "$OVERRIDES_DIR/config.yaml"                                  _bmad/bmm/config.yaml
  cp "$OVERRIDES_DIR/project-context.md"                          _bmad/project-context.md
  # 3-solutioning workflows
  mkdir -p _bmad/bmm/3-solutioning/create-architecture
  mkdir -p _bmad/bmm/3-solutioning/create-epics-and-stories
  cp "$OVERRIDES_DIR/3-solutioning/create-architecture/workflow.md"    _bmad/bmm/3-solutioning/create-architecture/workflow.md
  cp "$OVERRIDES_DIR/3-solutioning/create-epics-and-stories/workflow.md" _bmad/bmm/3-solutioning/create-epics-and-stories/workflow.md
  echo "  ✓ Workflow overrides applied"
fi
