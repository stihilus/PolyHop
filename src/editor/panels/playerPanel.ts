// The right-hand panel of the player: start of the level, look, attachments, movement, sounds.

import { attachmentAnchor } from '../../core/rig';
import { newId } from '../../core/types';
import { el } from '../ui/dom';
import { type Field, buildForm } from '../ui/form';
import { SPAWN_FIELDS, playerFields, playerLookFields } from './fields';
import type { PanelHost } from './host';

/** Models fixed to bones of the player's model: hat, hair, backpack. */
export function buildAttachmentsEditor(host: PanelHost): HTMLElement {
  const player = host.store.project.player;
  const playerModel = player.modelId ? host.store.getModel(player.modelId) : undefined;
  const bones = playerModel?.bones ?? [];
  const candidates = host.store.project.models.filter((m) => m.id !== player.modelId);

  const root = el('div', { class: 'attachments' });
  if (bones.length > 0 && playerModel) {
    root.append(
      el(
        'div',
        { class: 'button-stack' },
        el('button', {
          class: 'btn',
          text: 'Edit animations →',
          title: 'Open the player’s model in the animation editor',
          onclick: () => host.openAnimation(playerModel.id),
        }),
      ),
    );
  }
  root.append(el('div', { class: 'form-section', text: 'Attachments' }));
  if (bones.length === 0) {
    root.append(
      el('div', {
        class: 'empty muted',
        text: 'Pick a model with bones (like the Humanoid) to attach hats, hair or a backpack to it.',
      }),
    );
    return root;
  }
  if (player.attachments.length === 0) {
    root.append(el('div', { class: 'empty muted', text: 'Nothing attached. A model added here follows the bone it hangs on.' }));
  }

  player.attachments.forEach((a, index) => {
    const fields: Field[] = [
      {
        kind: 'select',
        key: 'modelId',
        label: 'Model',
        options: candidates.map((m) => ({ value: m.id, label: m.name })),
      },
      {
        kind: 'select',
        key: 'bone',
        label: 'Bone',
        options: bones.map((b) => ({ value: b.name, label: b.name })),
        hint: 'The part of the body it hangs on, for example Head for a hat',
      },
      { kind: 'vec3', key: 'offset', label: 'Offset', step: 0.01, unit: 'm', hint: 'From the bone’s pivot, in the rest pose' },
      { kind: 'vec3', key: 'rotation', label: 'Rotation', step: 15, unit: '°' },
      { kind: 'number', key: 'scale', label: 'Scale', min: 0.05, max: 10, step: 0.05 },
    ];
    const form = buildForm(fields, a as unknown as Record<string, unknown>, (key) => {
      if (key === 'bone' && playerModel) {
        // a different bone: start from where something worn there naturally sits
        a.offset = attachmentAnchor(playerModel, a.bone);
        host.store.playerChanged();
        host.refreshInspector();
        return;
      }
      host.store.playerChanged();
    });
    root.append(
      el(
        'div',
        { class: 'attachment' },
        form,
        el('button', {
          class: 'btn danger',
          text: 'Remove',
          onclick: () => {
            player.attachments.splice(index, 1);
            host.store.playerChanged();
            host.refreshInspector();
          },
        }),
      ),
    );
  });

  const add = el('button', {
    class: 'btn',
    text: '+ Attach a model…',
    disabled: candidates.length === 0,
    title: candidates.length === 0 ? 'Make a model first (Models tab), for example a hat' : 'Attach another model to a bone of the player',
    onclick: () => {
      const model = candidates[0];
      if (!model || !playerModel) return;
      const bone = bones.find((b) => b.name === 'Head') ?? bones[0]!;
      player.attachments.push({
        id: newId(),
        modelId: model.id,
        bone: bone.name,
        offset: attachmentAnchor(playerModel, bone.name),
        rotation: [0, 0, 0],
        scale: 1,
      });
      host.store.playerChanged();
      host.refreshInspector();
    },
  });
  root.append(el('div', { class: 'button-stack row' }, add));
  return root;
}

/** The whole panel of the player. */
export function buildPlayerInspector(host: PanelHost): void {
  const { store } = host;
  const player = store.project.player as unknown as Record<string, unknown>;
  const changed = (key: string) => {
    store.playerChanged();
    // the bones offered for attachments depend on the model
    if (key === 'modelId') host.refreshInspector();
  };
  host.inspector.append(
    el('div', { class: 'section-title', text: 'Player' }),
    buildForm(SPAWN_FIELDS, store.level as unknown as Record<string, unknown>, () => store.playerChanged()),
    buildForm(playerLookFields(store.project.models, host.textures.names()), player, changed),
    buildAttachmentsEditor(host),
    buildForm(playerFields(store.project.sounds.map((x) => ({ id: x.id, name: x.name }))), player, () => store.playerChanged()),
  );
}
