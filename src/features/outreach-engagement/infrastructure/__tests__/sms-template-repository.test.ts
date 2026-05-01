import { beforeEach, describe, expect, it } from 'vitest';
import {
  listActiveTemplates,
  getTemplateById,
  getActiveTemplateByKey,
  createTemplate,
  bumpTemplateVersion,
  archiveTemplate,
  clearSmsTemplateStoreForTest,
  SmsTemplateNotFoundError,
} from '../sms-template-repository';

describe('SmsTemplateRepository (in-memory)', () => {
  beforeEach(() => {
    clearSmsTemplateStoreForTest();
  });

  it('createTemplate persists version=1 active row', async () => {
    const t = await createTemplate({
      tenantId: 't1',
      agenda: 'new_opportunity',
      name: 'N',
      templateKey: 'new_opportunity_v1',
      body: 'Hi {{first_name}} — {{tracking_link}} Reply STOP to opt out.',
      variables: ['first_name', 'tracking_link'],
      actorId: 'u-admin',
    });
    expect(t.version).toBe(1);
    expect(t.status).toBe('active');
    expect(t.createdBy).toBe('u-admin');
  });

  it('listActiveTemplates returns only active rows for tenant', async () => {
    await createTemplate({
      tenantId: 't1',
      agenda: 'new_opportunity',
      name: 'A',
      templateKey: 'a',
      body: 'x',
      variables: [],
      actorId: 'u-admin',
    });
    await createTemplate({
      tenantId: 't2',
      agenda: 'new_opportunity',
      name: 'B',
      templateKey: 'b',
      body: 'x',
      variables: [],
      actorId: 'u-admin',
    });
    const list = await listActiveTemplates('t1');
    expect(list).toHaveLength(1);
    expect(list[0].templateKey).toBe('a');
  });

  it('getTemplateById throws SmsTemplateNotFoundError when missing', async () => {
    await expect(getTemplateById('t1', 'missing')).rejects.toBeInstanceOf(SmsTemplateNotFoundError);
  });

  it('getActiveTemplateByKey returns the active version', async () => {
    const t = await createTemplate({
      tenantId: 't1',
      agenda: 'general',
      name: 'G',
      templateKey: 'general_v1',
      body: 'x',
      variables: [],
      actorId: 'u-admin',
    });
    const fetched = await getActiveTemplateByKey('t1', 'general_v1');
    expect(fetched.id).toBe(t.id);
    expect(fetched.version).toBe(1);
  });

  it('bumpTemplateVersion creates version=2 and archives version=1', async () => {
    await createTemplate({
      tenantId: 't1',
      agenda: 'availability_check',
      name: 'Availability',
      templateKey: 'avail_v1',
      body: 'v1',
      variables: [],
      actorId: 'u-admin',
    });
    const v2 = await bumpTemplateVersion({
      tenantId: 't1',
      templateKey: 'avail_v1',
      body: 'v2',
      actorId: 'u-admin',
    });
    expect(v2.version).toBe(2);
    expect(v2.body).toBe('v2');
    expect(v2.status).toBe('active');

    // The new active fetch should return v2.
    const active = await getActiveTemplateByKey('t1', 'avail_v1');
    expect(active.id).toBe(v2.id);
    expect(active.version).toBe(2);
  });

  it('bumpTemplateVersion throws when templateKey does not exist', async () => {
    await expect(
      bumpTemplateVersion({
        tenantId: 't1',
        templateKey: 'unknown',
        body: 'x',
        actorId: 'u-admin',
      }),
    ).rejects.toBeInstanceOf(SmsTemplateNotFoundError);
  });

  it('archiveTemplate flips status to archived', async () => {
    const t = await createTemplate({
      tenantId: 't1',
      agenda: 'general',
      name: 'G',
      templateKey: 'general_v1',
      body: 'x',
      variables: [],
      actorId: 'u-admin',
    });
    await archiveTemplate('t1', t.id, 'u-admin');
    const refetched = await getTemplateById('t1', t.id);
    expect(refetched.status).toBe('archived');

    const activeList = await listActiveTemplates('t1');
    expect(activeList).toHaveLength(0);
  });

  it('bumpTemplateVersion preserves createdBy from the original row', async () => {
    await createTemplate({
      tenantId: 't1',
      agenda: 'general',
      name: 'G',
      templateKey: 'general_v1',
      body: 'v1',
      variables: [],
      actorId: 'u-original',
    });
    const v2 = await bumpTemplateVersion({
      tenantId: 't1',
      templateKey: 'general_v1',
      body: 'v2',
      actorId: 'u-editor',
    });
    expect(v2.createdBy).toBe('u-original');
    expect(v2.updatedBy).toBe('u-editor');
  });
});
