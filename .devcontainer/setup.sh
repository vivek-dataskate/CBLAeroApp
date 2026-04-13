#!/bin/bash
set -e

echo "╔══════════════════════════════════════════════╗"
echo "║       CBLAeroApp Codespace Setup             ║"
echo "╚══════════════════════════════════════════════╝"

# 1. Node dependencies
echo ""
echo "▶ Installing npm dependencies..."
npm install

# 2. Supabase CLI
echo ""
echo "▶ Installing Supabase CLI..."
npm install -g supabase --loglevel=error

# 3. Render CLI
echo ""
echo "▶ Installing Render CLI..."
npm install -g @render-oss/cli --loglevel=error 2>/dev/null || \
  curl -fsSL https://render.com/install-cli.sh | bash 2>/dev/null || \
  echo "  Render CLI — install manually if needed"

# 4. BMAD Method — all 6 modules
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

# 5. Git defaults
git config --global pull.rebase false
git config --global init.defaultBranch main

# 6. .env.local scaffold
if [ ! -f ".env.local" ]; then
  echo ""
  echo "▶ Creating .env.local scaffold..."
  cat > .env.local << 'EOF'
# ── App ───────────────────────────────────────────────
CBL_SESSION_SECRET=
CBL_APP_URL=http://localhost:3000

# ── Microsoft Entra SSO ───────────────────────────────
CBL_SSO_ISSUER=
CBL_SSO_CLIENT_ID=
CBL_SSO_CLIENT_SECRET=
CBL_SSO_ALLOWED_EMAIL_DOMAIN=cblsolutions.com
CBL_SSO_ALLOWED_TENANT_ID=

# ── Supabase ──────────────────────────────────────────
CBL_SUPABASE_URL=
CBL_SUPABASE_SERVICE_ROLE_KEY=
CBL_SUPABASE_SCHEMA=cblaero_app

# ── Data Residency ────────────────────────────────────
CBL_APPROVED_US_REGIONS=us-east-1,us-west-2
CBL_DATA_REGION=us-west-2
CBL_LOG_REGION=us-west-2
CBL_BACKUP_REGION=us-west-2

# ── Anthropic ─────────────────────────────────────────
ANTHROPIC_API_KEY=
EOF
  echo "  .env.local created — fill in your keys"
fi

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Setup complete!                             ║"
echo "║  1. Fill in .env.local                       ║"
echo "║  2. supabase start  (optional local DB)      ║"
echo "║  3. npm run dev                              ║"
echo "╚══════════════════════════════════════════════╝"
