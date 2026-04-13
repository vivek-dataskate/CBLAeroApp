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

# ── 3. Render CLI ───────────────────────────────────
echo ""
echo "▶ Installing Render CLI (optional — failure does not abort setup)..."
(npm install -g @render-oss/cli --loglevel=error 2>/dev/null || \
  curl -fsSL https://render.com/install-cli.sh | bash 2>/dev/null || \
  echo "  ℹ Render CLI skipped – install manually if needed") || true

# ── 4. BMAD Method – all modules ────────────────────
echo ""
echo "▶ Installing BMAD Method (all modules)..."
# Modules: bmm (default), bmb (Builder), cis (Creative Intelligence),
#          gds (Game Dev Studio), tea (Test Architect)
npx bmad-method install \
  --yes \
  --tools claude-code \
  --modules bmm,bmb,cis,gds,tea \
  --user-name "Vivek" \
  --output-folder _bmad-output

echo ""
echo "▶ BMAD status:"
npx bmad-method status

# ── 5. Git config (placeholder – user fills in) ─────
echo ""
echo "▶ Configuring git defaults..."
git config --global pull.rebase false
git config --global init.defaultBranch main

# ── 6. .env.local scaffold ──────────────────────────
if [ ! -f ".env.local" ]; then
  echo ""
  echo "▶ Creating .env.local scaffold..."
  cat > .env.local << 'EOF'
# ── Supabase ──────────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# ── Anthropic ─────────────────────────────────────────
ANTHROPIC_API_KEY=

# ── Render (set in Render dashboard env vars) ─────────
# RENDER_API_KEY=
EOF
  echo "  ✓ .env.local created – fill in your keys"
fi

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  ✅ Setup complete!                          ║"
echo "║                                              ║"
echo "║  Next steps:                                 ║"
echo "║  1. Fill in .env.local with your keys        ║"
echo "║  2. Run: supabase start  (local DB)          ║"
echo "║  3. Run: npm run dev                         ║"
echo "║  4. Sign in to GitHub Copilot in VS Code     ║"
echo "╚══════════════════════════════════════════════╝"
