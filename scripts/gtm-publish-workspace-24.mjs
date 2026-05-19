#!/usr/bin/env node
/**
 * gtm-publish-workspace-24.mjs
 *
 * Slice 2.11B.4 — Publicar workspace sGTM 24 em produção via Tag Manager API v2.
 *
 * Uso:
 *   node scripts/gtm-publish-workspace-24.mjs             # criar versão + publicar
 *   node scripts/gtm-publish-workspace-24.mjs --check-only  # verificar estado sem publicar
 *   node scripts/gtm-publish-workspace-24.mjs --get-current-version  # obter versão atual
 *
 * Service account: ~/secrets/decole/gtm-k6q4h6br-ndq3n-7525dc924517.json
 * Account: 6266094107 | Container: 241313282 | Workspace: 24
 */

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { GoogleAuth } from 'google-auth-library';

const ACCOUNT_ID = '6266094107';
const CONTAINER_ID = '241313282';
const WORKSPACE_ID = '24';
const SA_PATH = join(homedir(), 'secrets/decole/gtm-k6q4h6br-ndq3n-7525dc924517.json');
const BASE_URL = 'https://tagmanager.googleapis.com/tagmanager/v2';

const MODE = process.argv[2] || '';

async function getAuthClient() {
  const keyFile = JSON.parse(readFileSync(SA_PATH, 'utf8'));
  const auth = new GoogleAuth({
    credentials: keyFile,
    scopes: ['https://www.googleapis.com/auth/tagmanager.edit.containerversions',
             'https://www.googleapis.com/auth/tagmanager.publish',
             'https://www.googleapis.com/auth/tagmanager.readonly'],
  });
  return auth.getClient();
}

async function apiGet(client, path) {
  const url = `${BASE_URL}${path}`;
  const res = await client.request({ url, method: 'GET' });
  return res.data;
}

async function apiPost(client, path, body = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await client.request({ url, method: 'POST', data: body });
  return res.data;
}

async function getCurrentVersion(client) {
  const path = `/accounts/${ACCOUNT_ID}/containers/${CONTAINER_ID}`;
  const container = await apiGet(client, path);
  return container;
}

async function getWorkspaceStatus(client) {
  const path = `/accounts/${ACCOUNT_ID}/containers/${CONTAINER_ID}/workspaces/${WORKSPACE_ID}`;
  const workspace = await apiGet(client, path);
  return workspace;
}

async function quickPreview(client) {
  const path = `/accounts/${ACCOUNT_ID}/containers/${CONTAINER_ID}/workspaces/${WORKSPACE_ID}:quick_preview`;
  const result = await apiPost(client, path);
  return result;
}

async function createVersion(client) {
  const path = `/accounts/${ACCOUNT_ID}/containers/${CONTAINER_ID}/workspaces/${WORKSPACE_ID}:create_version`;
  const body = {
    name: `2.11B.4 — Multi-tenant lookup tables (workspace 24)`,
    notes: `Publicado por slice 2.11B.4. Workspace codex-2.11B.2-multitenant-preview com 5 lookup tables dinâmicas por tenant/produto. Validado em 2.11B.3 com superare-test (0 cross-tenant leaks).`,
  };
  const result = await apiPost(client, path, body);
  return result;
}

async function publishVersion(client, versionId) {
  const path = `/accounts/${ACCOUNT_ID}/containers/${CONTAINER_ID}/versions/${versionId}:publish`;
  const result = await apiPost(client, path);
  return result;
}

async function main() {
  console.log('=== GTM Publish Workspace 24 — Slice 2.11B.4 ===');
  console.log(`Account: ${ACCOUNT_ID} | Container: ${CONTAINER_ID} | Workspace: ${WORKSPACE_ID}`);
  console.log(`Service account: ${SA_PATH}`);
  console.log('');

  const client = await getAuthClient();

  // --- MODE: get-current-version ---
  if (MODE === '--get-current-version') {
    console.log('→ Obtendo versão atual do container...');
    const container = await getCurrentVersion(client);
    const cv = container.tagManagerUrl || '(sem URL)';
    console.log('Container:', container.publicId);
    console.log('Tag Manager URL:', cv);
    if (container.currentVersion) {
      console.log('Current Version ID:', container.currentVersion.containerVersionId);
      console.log('Current Version Name:', container.currentVersion.name);
    } else {
      console.log('currentVersion: (nenhuma versão publicada ainda)');
    }
    return;
  }

  // --- STEP 1: Verificar estado do workspace 24 ---
  console.log('→ STEP 1: Verificar estado do workspace 24...');
  const workspace = await getWorkspaceStatus(client);
  console.log('Workspace name:', workspace.name);
  console.log('Workspace description:', workspace.description || '(sem descrição)');
  console.log('Workspace fingerprint:', workspace.fingerprint);
  console.log('');

  // --- STEP 2: quick_preview para confirmar compilação OK ---
  console.log('→ STEP 2: Executando quick_preview (verificar compilerError)...');
  const preview = await quickPreview(client);
  const errors = preview.compilerError;
  if (errors) {
    console.error('❌ ERRO DE COMPILAÇÃO — NÃO publicar!');
    console.error('compilerError:', JSON.stringify(errors, null, 2));
    process.exit(1);
  }
  console.log('✅ quick_preview OK — sem compilerError');
  console.log('');

  if (MODE === '--check-only') {
    console.log('Modo --check-only: verificação concluída. Workspace 24 está OK para publicar.');
    return;
  }

  // --- STEP 3: Salvar versão atual (rollback reference) ---
  console.log('→ STEP 3: Salvar versão atual para rollback...');
  const container = await getCurrentVersion(client);
  const prevVersionId = container.currentVersion?.containerVersionId || '(nenhuma)';
  console.log(`prevVersionId (para rollback): ${prevVersionId}`);
  console.log(`  → Registrar este ID no slice file antes de continuar`);
  console.log('');

  // --- STEP 4: Criar versão a partir do workspace 24 ---
  console.log('→ STEP 4: Criando versão a partir do workspace 24...');
  const versionResult = await createVersion(client);
  const versionId = versionResult.containerVersion?.containerVersionId;
  const versionName = versionResult.containerVersion?.name;

  if (!versionId) {
    console.error('❌ Falha ao criar versão — containerVersionId não retornado');
    console.error('Resposta:', JSON.stringify(versionResult, null, 2));
    process.exit(1);
  }

  console.log(`✅ Versão criada: versionId=${versionId}`);
  console.log(`   Nome: ${versionName}`);
  console.log('');

  // --- STEP 5: Publicar a versão ---
  console.log(`→ STEP 5: Publicando versão ${versionId} em produção...`);
  const publishResult = await publishVersion(client, versionId);
  const publishedVersionId = publishResult.containerVersion?.containerVersionId;
  const compilerStatus = publishResult.compilerError;

  if (compilerStatus) {
    console.error('❌ ERRO ao publicar — compilerError durante publish!');
    console.error(JSON.stringify(compilerStatus, null, 2));
    console.log(`→ Rollback: publicar a versão anterior (prevVersionId=${prevVersionId})`);
    process.exit(1);
  }

  if (!publishedVersionId) {
    console.error('❌ Publish pode ter falhado — containerVersionId não retornado');
    console.error('Resposta:', JSON.stringify(publishResult, null, 2));
    process.exit(1);
  }

  console.log(`✅ PUBLICADO com sucesso!`);
  console.log(`   versionId publicado: ${publishedVersionId}`);
  console.log(`   Container: ${publishResult.containerVersion?.container?.publicId}`);
  console.log('');

  // --- STEP 6: Verificar estado do workspace pós-publish ---
  console.log('→ STEP 6: Verificar estado do workspace 24 pós-publish...');
  try {
    const workspacePost = await getWorkspaceStatus(client);
    console.log('Workspace fingerprint pós-publish:', workspacePost.fingerprint);
  } catch (err) {
    const status = err.response?.status;
    if (status === 404) {
      console.log('Workspace 24 não existe mais após publish — comportamento esperado do GTM.');
    } else {
      throw err;
    }
  }
  console.log('');

  // --- RESUMO FINAL ---
  console.log('=== RESUMO ===');
  console.log(`prevVersionId (rollback): ${prevVersionId}`);
  console.log(`versionId publicado:      ${publishedVersionId}`);
  console.log(`Container:                ${publishResult.containerVersion?.container?.publicId}`);
  console.log('');
  console.log('→ Próximos passos (smoke):');
  console.log('  dig +short sgtm.decolesuacarreiraesg.com.br CNAME');
  console.log('  curl -s -o /dev/null -w "%{http_code}" https://sgtm.decolesuacarreiraesg.com.br/g/collect');
  console.log('');
  console.log(`→ Registrar no slice file:`);
  console.log(`  prevVersionId: ${prevVersionId}`);
  console.log(`  versionId publicado: ${publishedVersionId}`);
}

main().catch((err) => {
  console.error('❌ Erro fatal:', err.message || err);
  if (err.response?.data) {
    console.error('Detalhes da API:', JSON.stringify(err.response.data, null, 2));
  }
  process.exit(1);
});
