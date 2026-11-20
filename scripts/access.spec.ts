import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { bootstrapData } from '../tests/helpers/bootstrap-data';
import { getTestGroup, openTestUserForm, readEditRights, restoreTestUserProfile, setTestGroup } from '../tests/helpers/access';

test('Membership cleanup preserves other groups and saved profile permissions', async ({ browser }) => {
  const groupId = '1'.repeat(32);
  let enabled = true;
  let profileEditable = false;
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (request.url === '/edit_groups_users/') {
      response.end(`<table><tr rec_id="${groupId}"><td></td><td>${bootstrapData.group}</td></tr></table>`);
    } else if (request.url === '/save_user_on_groups/') {
      enabled = !enabled;
      response.end('{}');
    } else if (request.url === '/edit_users/') {
      response.end(JSON.stringify({ count: enabled ? 2 : 1, profileEditable }));
    } else if (request.url === '/edit_user/') {
      response.end('{}');
    } else if (request.url === '/save_user/') {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        profileEditable = JSON.parse(body).profileEditable;
        response.end('{}');
      });
    } else {
      response.end(`<!doctype html><meta charset="utf-8">
        <div id="panel_right"><button title="Пользователи" onclick="fetch('/edit_users/').then(r => r.json()).then(data => {
          document.querySelector('td.group').textContent = data.count;
          document.querySelector('#enable_edit').checked = data.profileEditable;
        })">Users</button></div>
        <table id="table_option"><tr fl="${bootstrapData.login.toLowerCase()}">
          <td class="group" onclick="fetch('/edit_user_on_groups/').then(() => document.querySelector('#form_edit_user_on_groups').hidden = false)">${enabled ? 2 : 1}</td>
          <td class="edit" onclick="fetch('/edit_user/').then(() => document.querySelector('#form_edit_user').hidden = false)">Edit</td>
        </tr></table>
        <div id="form_edit_user_on_groups" hidden><table><tr id="${groupId}"><td class="${enabled ? 'check' : 'uncheck'}"
          onclick="this.className = this.className === 'check' ? 'uncheck' : 'check'">Group</td></tr></table>
          <button id="form_cancel" onclick="this.parentElement.hidden = true">Cancel</button>
          <button id="form_ok" onclick="fetch('/save_user_on_groups/').then(() => {
            document.querySelector('td.group').textContent = document.querySelector('#form_edit_user_on_groups td').className === 'check' ? '2' : '1';
            this.parentElement.hidden = true;
          })">Save</button>
        </div>
        <div id="form_edit_user" hidden>
          <input id="name" value="Оператор"><input id="change_password" type="checkbox">
          ${['enable_edit', 'enable_edit_config', 'enable_edit_devices'].map(id => `<label><input type="checkbox" id="${id}"><span>${id}</span></label>`).join('')}
          <button id="form_cancel" onclick="this.parentElement.hidden = true">Cancel</button>
          <button id="form_ok" onclick="fetch('/save_user/', { method: 'POST', body: JSON.stringify({ profileEditable: document.querySelector('#enable_edit').checked }) }).then(() => this.parentElement.hidden = true)">Save</button>
        </div>`);
    }
  });
  await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server did not start');
  const context = await browser.newContext({ baseURL: `http://127.0.0.1:${address.port}` });
  try {
    const page = await context.newPage();
    await page.goto('/');
    expect(await getTestGroup(page)).toBe(true);
    await setTestGroup(page, false);
    await expect(page.locator('td.group')).toHaveText('1');
    expect(await getTestGroup(page)).toBe(false);
    await setTestGroup(page, true);
    await expect(page.locator('td.group')).toHaveText('2');
    expect(await getTestGroup(page)).toBe(true);
    const form = await openTestUserForm(page);
    const original = { name: await form.locator('#name').inputValue(), rights: await readEditRights(form), profileEditable: true };
    await form.locator('#form_cancel').click();
    await restoreTestUserProfile(page, original);
    await openTestUserForm(page);
    await expect(form.locator('#enable_edit')).toBeChecked();
    expect(await readEditRights(form)).toEqual(original.rights);
    await form.locator('#form_cancel').click();
    await restoreTestUserProfile(page, { ...original, profileEditable: false });
    await openTestUserForm(page);
    await expect(form.locator('#enable_edit')).not.toBeChecked();
    expect(await readEditRights(form)).toEqual(original.rights);
  } finally {
    await context.close();
    await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
  }
});
