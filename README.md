# PolyHop

A web-based editor + engine for low-poly / pixel-texture 3D platformers in the spirit of
*A Short Hike*, *Alba*, *Spyro* and *Harry Potter 1*. No programming: levels, objects and game logic
are built with panels and settings screens. Projects export to a static HTML5 build for itch.io.

Reference tools: Blockbench (cube modeling), Crocotile 3D (tile-based layout + painting).

## Run

```bash
npm install
npm run dev        # editor at http://127.0.0.1:5173
npm test           # player controller unit tests
npm run build      # production build in dist/ (static, itch.io friendly)
```

Textures: every PNG in `assets/textures/` is an atlas. The tile size is parsed from the file name
(`Textures-16.png` = 16×16 px tiles). Add more files and restart the dev server.

## Layout

```
src/core/      project data model (plain JSON), meshes and their edit operations, UVs, pixels, storage
src/runtime/   everything the exported game needs: physics, player controller, camera, input (keyboard, mouse,
               gamepad, touch), level, model meshes, player preferences
src/player/    the exported game's page: start / pause screen, the player's settings menu, touch controls
src/editor/    editor UI: store, level viewport, model editor, paint editor, gizmo, forms, dialogs
src/editor/panels/   the right-hand properties panels and the Assets list (plain functions that get the
               editor through a small `PanelHost`), kept out of `app.ts`
tests/         vitest unit tests (player controller, pixels, UVs, shapes, geometry, logic, export)
```

`runtime/` never imports from `editor/`, so the exported game ships without any editor code.

## Modes

The top bar switches between the editors:

| Mode | What it does |
| --- | --- |
| **Level** | Place blocks, model instances and the player spawn. Assets explorer, drag a model into the view, Play. |
| **Models** | Build a model from cubes, pick its texture, map each face to the texture (UV). |
| **Paint** | Paint whole texture atlases. New / import / duplicate / delete textures. |
| **Animate** | Keyframe clips for models with bones (the player's walk, a spinning coin, a door). |
| **Audio** | Synthesized sound effects, chip-tune music, imported sound files. |

### Game logic: variables, rules and the HUD

Everything the game does is data, no scripting. There are two parts.

**Variables** (left panel > *Variables*): numbers the game keeps track of, such as `coins`, `keys` and
`health`. Each has a start value, an optional min and max (health 0 – 3), and can be shown on the screen
with an icon and a label while playing.

**Rules** (select any object > *Behavior*): "When ..., if ..., then ...".

| Part | Choices |
| --- | --- |
| When | the player touches this · the player **jumps on top of** this · the player presses **Interact** (E) near this · the level starts · some seconds have passed (once, or repeating) · the conditions become true |
| If | any number of tests on variables: `keys >= 1`, `health < 3`, ... (all must hold) |
| Then | set a variable · change it by an amount · remove an object · **move an object** · **move it back and forth** · **play an animation** · show a message · play a sound · respawn · save a checkpoint · **show the end screen** · **go to a level** · **chase the player** · **hurt the player** · **bounce the player** · **talk** · **ask a question** · restart the game |

Rules run top to bottom and see each other's changes, so put the "otherwise" case first (that is how the
Door preset is written: *locked* first, then *opens and uses the key*).

- **Which object?** *Remove*, *Move* and *Play animation* act on **This object** or on any other object of the
  level you pick from the list, so a button can open a door far away.
- **Move object** slides it by an offset (x, y, z in meters) over some seconds, smoothly. A solid object
  takes its collision with it, and its "touch" area too. The door preset raises the door by 3 m.
- **Move back and forth** is the same slide, there and back again for ever: a moving platform (the player
  standing on it rides along) or an enemy that patrols (give a Hazard this action).
- **Play animation** switches an instance to one of its model's clips (or back to standing still).
- **Enemies:** *Chase the player* makes an object walk toward the player (speed in m/s, and the range inside which it
  notices them). It follows the ground, falls off ledges, turns to face where it goes and will not climb walls
  higher than half a meter. *Hurt the player* takes an amount off a variable (health), flings the player away from the
  object and gives about a second of blinking peace, with a red flash. *The player jumps on top of this* fires when the
  player comes down on an object that has such a rule (otherwise the touch rules fire): *Bounce the player up* throws
  them up again and refills the double jump. The **Slime** asset puts these together: it chases, hurts, and is gone
  when stomped.
- **Conversations:** *Talk* shows a box with the speaker and one line at a time; Interact, Jump or a click reads on and
  the game waits meanwhile. *Ask a question* shows up to four answers (keys 1-4 or a click); each answer carries its own
  list of actions (give a coin, open a door, move on to the next dialogue). `{coins}` in any text shows a variable. The
  **Villager** asset is a ready-made talker (rule *Interact -> Talk*).
- **Voices:** the words appear letter by letter, with a short blip for every other letter, a little higher or
  lower each time, like the villagers in Animal Crossing or the talkers in Zelda. A comma or a full stop makes the
  text wait a moment. Interact / Jump / a click first shows the rest of the line at once, then reads on (a question
  shows its answers when it is fully there). Every *Talk* and *Ask a question* has **Voice** (blip, soft, deep,
  chirp, mumble, any sound of your own from the Audio tab, or Silent), **pitch** (0.5 to 2: a deep old man, a
  squeaky kid) and **speed** (letters per second, 0 shows the line at once). The built-in voices are ordinary
  sounds in the Audio tab, so you can edit them. A project from before voices still works: they are always there.
- **Texts can show values:** `Coins: {coins}` in a message or the end screen is filled in with the
  variable `coins`.
- **End screen:** the game freezes and shows a title, a text and the buttons *Play again* (and *Back to
  editor* while testing). The exported game only has *Play again*.
- **Timers** count from the start of the level. *Conditions become true* fires once when its tests turn
  from false to true (and again if they turn false and true again), for example "coins >= 5, open the gate".

### Game objects as assets

Every game object is an **asset** in *Assets > Game objects*, next to the models. Click one to edit it in
Properties (look and behavior), double-click it or drag it into the view to place it.

| Built-in | What it does |
| --- | --- |
| Coin | +1 `coins`, then disappears |
| Key | +1 `keys`, a message, disappears |
| Apple | +1 `health` (only when it is below the maximum), disappears |
| Door | solid; touched with a key it opens (slides up) and uses the key, otherwise says it is locked |
| Checkpoint | the next respawn happens here |
| Hazard | −1 `health`, back to the last checkpoint; at 0 the game restarts |
| Goal | a trophy; touching it ends the game with a “You win!” screen showing the coins |
| Exit | a purple slab; touching it goes on to the next level |
| Moving platform | a slab that slides 4 m back and forth (*when the level starts, move back and forth*) |
| Slime | a blob that chases the player within 11 m, hurts on touch (1 heart, knock back), is stomped by jumping on it; at 0 health the game restarts |
| Water | a see-through 8 × 2 × 8 m pool the player swims in (see *Look*) |
| Villager | a character that talks when the player presses Interact next to it |
| Sign | a wooden board; pressing Interact next to it shows its message (“E: interact” appears when you are close) |

- **Edit an asset:** name, tint, solid, size, texture (blocks) or model, animation (pickups), and all its rules.
  What you place afterwards follows it. **Reset** puts a built-in one back as it came.
- **Your own assets:** *+ New object…* asks what it is made of: a **plain block** or **one of your models**
  (a crate, a creature, ...), then you give it a behavior. **Looks like** at the top of an asset's Properties
  changes that later (block <-> any model; the rules are kept). Or select any object in the level and press
  **Make an asset** in its Properties (shape, look and behavior are kept). **Duplicate** copies an asset,
  **Delete** removes your own (placed objects stay).
- **Placed objects remember their asset.** In the asset, **Update N placed** brings every object placed from it,
  in all levels, in line with it (rules, solid, texture, tint, model, animation). Position, turn, size and name
  of each object stay. On a single object, **Update from asset** does the same and **Save to asset** makes the
  asset take over the object (also its shape and size).
- The asset list is part of the project file, so your changes travel with it.

The rules of a preset can also be put on any object with *Behavior > Make this a…*.

Pickups are ordinary models (`Items-16.png` atlas, a spinning animation), so they can be re-textured and
re-animated in the Models and Animate tabs. The default level has coins, a key, a locked door, an apple, a checkpoint, a hazard, a lift and a goal on top of the platforms.
While playing, the HUD (top right) shows the variables marked *On screen*, with messages at the bottom.
Objects taken away or moved during a run come back when you stop (the game plays a copy of the level).

### Levels

A project can have **several levels**, played in order. The list is at the top of the left panel.

| What | How |
| --- | --- |
| Switch | The dropdown picks the level you edit. **Play** starts at that level; an exported game starts at level 1. |
| + New / Copy / Delete | A new level starts with a flat ground. *Copy* duplicates the level (rules that point at objects of the level follow the copy). A project keeps at least one level. |
| Rename / ◀ ▶ | Rename it, or move it earlier / later in the play order. |
| Sky | The color swatch under the buttons sets the sky and the distance fog of the level (a cave can be dark). |
| Start point | Every level has its own start: select the **Player** in that level and drag the gizmo, or type the position. |
| Moving on | An **Exit** (or any rule with *Go to level*) goes to the next level, or to a level you pick. After the last level the end screen appears. |

Variables carry over from level to level (so coins are kept); the checkpoint and the objects are per level.
*Restart the game* and *Play again* go back to the first level with fresh variables. Undo / redo covers adding,
renaming and deleting levels too.

### Look: light, shadows, water and resolution

- **Level look** (select nothing, then Properties): the **sky**, the **fog**, the **sun** (direction, height, color,
  strength), the **ambient** light and **Shadows**. Every level has its own: a dark cave, a red evening, a foggy
  morning. Real sun shadows are hard-edged (they suit pixel textures) and follow the player; switched off, a round
  blob stays under the player.
- **Sky:** *Time of day* buttons (Day, Dawn, Sunset, Night, Overcast) set the sky, the fog and the light together as one
  undo step; after that every part can be changed. **Style**: *Flat color*, *Gradient* (horizon color up to a top
  color), *Clouds* (a gradient with soft pixel clouds), *Stars* (a night sky) or *Picture*: any texture of the project
  as a panorama that wraps around the world (its middle row is the horizon; a wide 2:1 picture works best; import or
  paint one in the Paint tab, small pictures keep their hard pixels). The horizon color is also the swatch in the
  level bar.
- **Fog:** **Starts at** / **Ends at** are distances from the camera, so a small level needs short ones to show any
  fog at all (the default 60 / 160 m only fades things that are far away; try 10 / 60). **Own color**: off, the fog
  takes the horizon color of the sky (for a picture, the average of its middle rows) so far things melt into the
  sky; on, any color you pick (a green swamp, a red haze).
- **Over the sky:** how much the fog covers the sky itself. The horizon is always fog colored; 0 leaves the rest of
  the sky clear, 0.3 (the default) is a haze that is thick at the horizon and clears upward, 1 hides the whole
  sky. It grows with thick fog (a short *Ends at*) and is gone when the fog is far away. Clouds and stars are
  covered too, and a picture sky gets the fog laid over it.
- **Opacity** (block properties): lower than 1 makes a block see-through (glass, a ghost, water). See-through shapes
  cast no shadow.
- **Water:** the **Water** game object (Assets) is a 8 × 2 × 8 m see-through pool. Any block with **Water (swim)**
  ticked is a body of water (set it not Solid): the picture flows slowly, the player swims in it. Swimming: holding
  **Jump** swims up (a jump press at the surface hops out), **Crouch** dives, you move at 0.6 × speed and sink slowly;
  the humanoid does a front crawl (`swim` pose) and the screen gets a blue tint when the camera is under water.
- **Resolution** (Project Settings > Graphics): Full, Half, Third or Quarter. A lower setting draws the game coarser and
  the browser blows it up with hard pixel edges while you play and in the exported game: the chunky look of an old
  console (and it runs faster on weak machines).

### Animations

The **Animate** tab edits the clips of a model with bones (the Humanoid, or any rig you import or build).
The player plays the clips named `idle`, `walk`, `run`, `jump`, `fall`, `crouch` and `crouch_walk`; any
other clip is yours to use. Edits show up the next time you press Play, no export needed.

| What | How |
| --- | --- |
| Pick a clip | Left panel > Animations. **+ New** makes an empty looping, smooth clip; Duplicate and Delete work on the selected one. |
| Pose a bone | Click it in the 3D view or in the Bones list, then drag the rotate gizmo (E) or the move gizmo (W). The gizmo works in the bone's parent frame, so an arm turns around the shoulder. A key is made at the playhead automatically. |
| Numbers | Properties > Bone: rotation (°) and position (m) at the playhead; typing makes a key. **Reset here** keys the rest pose. |
| Timeline | Click the ruler to scrub; ← / → step a frame (Shift = 5). Drag a diamond to move a key (orange = rotation, blue = position); Delete removes the selected one; K keys the selected bone. Space plays, with 0.25× - 2× speed. |
| Walk cycles | Pose the first half, **Copy pose**, move the playhead, **Paste ⇄** (mirrored: left and right swapped). |
| Clip settings | Duration (stretches the keys), Loop (wraps around; the last key follows the first until you give it its own value, so a spin can end at 360°), Smooth (curves through the keys instead of straight lines; turn it off for a constant-speed spin). |
| Undo | Ctrl/Cmd+Z and +Shift+Z, per model. |
| A new model | Every model is listed. One without bones is shown as it is, with two buttons: **One bone for the whole model** (a spinning coin, a bobbing platform) or **One bone per shape** (a door, a wheel). Then pose it right away; the first animation is made for you. |
| Pivot | Properties > Bone > Pivot: the joint the bone turns around (a door turns about its hinge). Type it, or use center / top / bottom of the bone's shapes. |
| In the level | Select a model in the Level and pick **Animation** in its properties: it plays that clip in a loop (also while editing), with its own speed. Its collision box stays where it was. |

### Built-in props (Models)

Every project starts with 47 ready-made models in **Models** (and Assets > Models), blocky-cute props with
16 px tiles from `assets/textures/Props-16.png`. They are ordinary models: place them, re-texture them, change
their cubes, animate them, or build a game object asset from one (*Assets > + New object… > Made of a model*).

| Group | Models |
| --- | --- |
| Plants and rocks | Bush, Cactus, Mushroom, Pumpkin, Hay bale, Boulder, Mossy boulder |
| Sprites (crossing planes with cut-out pixels) | Poppy, Cornflower, Dandelion, Daisy, Tulip, Sunflower, Tall grass, Fern, Sapling, Wheat, Rose bush, Reeds |
| Furniture and props | Crate, Barrel, Chest, Torch, Lantern, Campfire, Fence, Bench, Table, Bookshelf, Well, Anvil, Gravestone, Banner, Signpost, Lamp post, Bed, Candle, Snowman, Scarecrow |
| Potions and gems | Red / Blue / Green potion, Ruby / Emerald / Sapphire / Amethyst / Diamond crystals |

Some come with animations (pick them in a placed instance's **Animation**): Chest `open` / `close`, Torch, Candle and
Campfire `flicker`, Banner `sway`, the crystals `spin`. Sprites and thin parts are cut-out planes: switch **Solid**
off for them if you want the player to walk through. `python3 tools/make-props.py` redraws the atlas; the models
are described in `src/core/props.ts`. Older projects get the props once when they are opened.

The atlas also holds tiles that no model uses (ore, bark, leaves, planks, cobblestone, ...): they are there to
paint on shapes with the Paint tool. There are deliberately **no trees and no stacked-cube building blocks** among
the models; scenery and building parts are meant to be modeled shapes, not voxels.

### Models as files, and the demo (Mossy Hills)

Every `assets/models/*.json` is a model (the same JSON a project keeps for its models) that is part of every new
project, like the props and the building kit. Drop a file there and rebuild to add one. The ones that ship are the
irregular low-poly models of the demo (`tools/make-demo.py` makes them, the demo atlas `Demo-16.png` and the
splash picture): **Star crystal** (spins, collectible), **Crystal cluster**, **Ruin column** (broken, with a rune
band) and **Thorn spikes**. Models are an older project's too: projects from before version 10 get them once.

**Example: Mossy Hills** (File > New project > Example) is made of the same data as any project, so it can be
opened and changed:

| Level | What it shows |
| --- | --- |
| **1. Meadow** (easy, a valley) | A sculpted terrain (hills, a rim, a path painted in dirt, a sandy pond), a village of kit houses, trees and flowers, water you can swim in with an island, a platform that carries you over it, a villager (**Old Moss**) with a deep voice who asks a question with three answers, a sign, a checkpoint, slimes to stomp, coins, an apple, a ruin tower of stones to climb, a spring mushroom that bounces you up to a ledge of coins, and an old gate that opens (a *when* rule) once three **star crystals** are found. The portal behind it goes to level 2. |
| **2. Sky Ruins** (harder, a sunset) | Islands and stones in the air, a moving platform, a run of narrow pillars that need a run and a double jump, spikes, slimes, a spring mushroom up to a high ledge with the **key**, a glide over a big gap (the demo turns **Glide** on), a temple with a **locked door** and the **trophy**. Bonus stars can be found on the way. Falling puts you back at the checkpoint. |

The hero wears **Character-Explorer.png**, a skin made for the demo (a green cap, a red scarf, a tunic and boots;
`tools/make-humanoid.py`). It is in every project: select the player > Skin. (The same outfit exists for the
female character as `Character-Female-Explorer.png`.)

### Building kit and trees (Models)

Besides the props, every project has about 30 **modeled** building parts and trees (`Kit-16.png`, `src/core/kit.ts`):
real shapes (arches, tapered cylinders, cones, spheres, stairs), not stacks of cubes.

| Group | Models |
| --- | --- |
| Walls and pieces | Stone wall, Stone pillar, Archway, Stone stairs, Wooden stairs, Flagstone slab, Cobble path, Iron gate, Wooden fence |
| Buildings | Cottage (timber frame, gable roof, shutters, chimney), Round tower, Roof piece, Chimney, Stone bridge, Wooden bridge, Market stall, Windmill (`turn`), Lighthouse |
| Rocks | Large boulder, Standing ring |
| Trees and plants | Oak, Cherry, Autumn, Pine, Birch, Palm and Dead tree (tapered trunks, round crowns, cones), Round bush, Hedge, Tree stump, Fallen log, Giant mushroom |

Parts are meant to be combined: copy a wall along a line, put an archway in it, a tower at the corner. Stairs,
arches and bridges are collided as real surfaces, and the player walks up the stairs. `python3 tools/make-kit.py`
redraws the atlas.

### Renaming

Double-click a name to rename it in place, or press **F2** on the selected object or shape. This works for
the objects in the Level scene list, models in the assets grid (double-click the name) and in the Models
tab, shapes, animations and bones. Renaming a bone also renames it in every animation and in the player's attachments.

### The player character

The player is **1.8 m tall** by default (Width 0.6 m, crouch 1.1 m, camera 6.5 m behind). The model is scaled to the
player's **Height**, so changing it changes both what you see and the collision shape.

New projects have two low-poly characters, **Humanoid** and **Humanoid (female)**, built like the figures of
a stylized adventure game: a big head that is nearly a cube (a quarter of the body), no nose in the geometry (the
face with its big eyes is painted), small ears, a short neck, a broad chest, arms with a separate hand, legs with
a long flat foot. The hair is made of parts of its own (a cap over the head and a slab behind it; the female
character also has two locks at the sides and hair down her back) that follow the head, so a skin can give the
character any hair, a cap or none. Every part is a box that narrows toward the wrists and ankles, so the body is not
a stack of plain boxes. Both are normal models with the same skeleton (`Root`, `Hips`, `Waist`, `Chest`, `Neck`,
`Head`, `RightUpperArm`, `RightForearm`, `RightHand`, `RightThigh`, `RightShin`, `RightFoot` and the same on the
left, plus the ears), so every animation fits both, and everything below also works for models you make or import.
The female build differs in its proportions: narrower shoulders and waist, wider hips, slimmer arms. Pick the
model in Player > Look > Model; its skin follows when you change from one to the other.

| What | How |
| --- | --- |
| **Animation** | The Humanoid has `idle`, `walk`, `run`, `jump`, `fall`, `glide`, `swim`, `crouch` and `crouch_walk`. The player picks one from what it is doing (speed, in the air, crouching) and blends between them. A walk plays faster when the player is faster. |
| **Skin** | Select the player > **Skin**. Any texture with the layout of the model works. For the Humanoid: `Character-Skin.png` (a plain outfit), `Character-Explorer.png` (the demo's hero) and `Character-Template.png`; for the female one: `Character-Female-Skin.png`, `Character-Female-Explorer.png` and `Character-Female-Template.png`. A template paints every body part in its own color with a white dot in the corner of each face, so you can see where things go. Paint a skin in the Paint tab: clear pixels on the hair parts show the head under them, so a character can be bald. |
| **Attachments** | Select the player > **Attachments > + Attach a model…**. A model (hat, hair, backpack) hangs on a bone such as `Head`, with an offset, rotation and scale, and follows the animation. Bones are matched by name, so attachments survive a model swap. |
| **Rig panel** | Models tab > **Rig**: lists the bones (name, parent, pivot), adds bones, previews every animation (and **Edit animations →** opens the animation editor). A shape's **Bone** says what it moves with. |
| **Import** | File > **Import rig model (.json)…** reads a Blockbench Hytale "blockymodel" file (elements with `from` / `to`, `rotationOrigin`, per-face UVs and children) as a model with bones. Import its PNG in the Paint tab, then pick it as the model's texture. |

Conventions: the model's origin is the middle of its feet, +Y is up and **+Z is the front**; the right
hand of a character is toward -X. Animation clips are plain keyframes (rotation in degrees, position
in meters) keyed by bone name, so a clip works on any rig with bones of those names.
`python3 tools/make-humanoid.py` makes both characters (`src/core/humanoid.model.json` and
`humanoid-female.model.json`) and draws the six skins from the same numbers, so they always fit. A skin is
128 × 128 px: every part has a cross of its six faces (top and bottom above, then right, front, left and back),
packed row by row; left and right limbs have rectangles of their own. The two characters have layouts of their own
(their parts differ in size), so a skin is for one of them. Projects made before this version get the new humanoid
when they are opened (a skin by an old name becomes the same skin by its new name; things worn on the old nose
move to the head).

### Grass, leaves and other transparent textures

- **+ Add shape… > Plane / Grass tuft** (Level and Models). A plane is one upright quad without thickness,
  a grass tuft is two crossing planes. Both are drawn from **both sides** and are **not solid** (the
  player walks through them); the tuft starts turned by 45° so it looks like an X from any direction.
- **Transparency:** pixels of a texture that are more than half transparent are cut out, in blocks and in
  models (no sorting problems, depth is correct). Paint transparent pixels with the Eraser in the Paint
  tab, or import a PNG with an alpha channel. The tile picker shows transparent pixels on a checkerboard.
- **Both sides** (block inspector) can be turned off for a shape that should only be visible from its
  front. Models are always drawn from both sides.
- `assets/textures/Plants-16.png` is a small starter atlas (grass, flowers, mushroom, bush). New planes and
  tufts pick an atlas whose name contains plant / grass / foliage / leaf, so they show grass right away.
- Not supported yet: partially transparent blending (glass, water). Pixels are either solid or cut out.

### Saving

**Save** (button next to File, or Ctrl/Cmd+S) writes the whole project into one file: settings, player,
level, every model and every texture. Atlases from `assets/textures` that the project uses are copied
into the file too, so it looks the same on another machine.

| Action | What it does |
| --- | --- |
| Save | The first time it asks for a file name, afterwards it overwrites that same file (Chrome / Edge). Other browsers download a fresh copy each time. |
| Save as… (Ctrl/Cmd+Shift+S) | Always asks for a new file. |
| Open project… | Loads a saved file and keeps Save pointed at it. |
| New project | Asks what to start with (see below) and forgets the file. |

**Starting.** The first time the editor opens (and with **New project**) a dialog offers **Blank project** (an empty
level with a floor) or **Example: Mossy Hills**, a small two-level game made with what the editor offers (below).
Closing the dialog keeps what is open.

The top bar shows the file name and `unsaved changes` when the project differs from the file. The
project is also autosaved in the browser as a backup, which only matters if you forget to Save.
The file is plain JSON (`<name>.polyhop.json`), so it can also be diffed or edited by hand.

### Sound and music

The **Audio** tab holds every sound of the project. Nothing needs a sound file: effects are synthesized
(sfxr style) and music is a small chip tune sequencer, both stored as a few numbers in the project.

| What | How |
| --- | --- |
| **Sound effect** | *+ Sound effect*, then pick a preset (Coin, Jump, Hit, Power-up, Explosion, Laser, Blip, Door, Random) and tune the sliders (envelope, pitch, tone, filter). **Mutate** nudges every value a little. Sliders play the sound when released. |
| **Music** | *+ Music*: tempo, scale, key, a loop of 8 to 512 steps (16 steps = one bar, 512 = 32 bars) and up to 8 channels, edited in a piano roll (below). **Random tune** writes a lively melody in the chosen scale, **Calm tune** a slow spacious one (see below). |
| **Piano roll** | The rows are the notes of the scale (named on the keys at the left; the root is tinted), the columns are steps, with bars and beats marked on the ruler. **Click** puts a note (and plays it), **click it again** takes it away, **drag** draws a run of notes, **right-drag** (or Alt + drag) erases. A note is drawn as long as it lasts; a piano's fades, a pad's swells. The other channels show as faint lines, so a bass and a melody can be lined up. **Space** plays and stops, a **play position** moves along the loop, and a click on a bar number selects the bar and (while playing) jumps there. |
| **Bar tools** | With a bar selected (or none: the whole channel): **Copy** and **Paste** (Ctrl/Cmd + C, V), **Repeat →** copies the bar over all the bars after it, **Clear** (Delete), **↑ ↓** move the notes up and down the scale (Shift = an octave) and **← →** move them in time (Alt + arrows). **Undo / Redo** (Ctrl/Cmd + Z) take back any change. |
| **Mute and solo** | **M** and **S** on a channel tab silence it, or everything else, in the preview only; the tune itself does not change. |
| **Instruments** | Per channel: *Square*, *Triangle*, *Sawtooth*, *Sine* (chip sounds), *Soft piano*, *Bell*, *Pad* (soft, slow swell) and *Noise (drums)*. **note: N steps** is how long a note lasts: a piano rings that long, a pad swells and fades over it, chip notes fill it. |
| **Space** | A slider for the size of the room (reverb): the notes ring on and fill the gaps. The loop wraps around, so the tail of the last notes runs into the start without a seam. |
| **Import** | *Import…* reads a WAV / OGG / MP3 file (stored inside the project). |
| **Starter sounds** | Puts the built-in set back (coin, key, door, hit, power-up, checkpoint, jump, double jump, land, theme). |
| **Use a sound** | Rules > *Play sound* (the presets already do), Player > *Sounds* for jump / double jump / land, Project settings > *Sound* for the music and the volume. |

The music loops while playing and stops with Stop. In an exported game **M** mutes everything.

**The main theme** (the default music of a new project, *Theme* in the list) is a calm piece in the spirit of
Minecraft's: a slow soft piano with long silences, an arpeggio underneath, a few bells and three pads in a big
room. It is a loop of 128 seconds (60 bpm, 512 steps, 7 channels), so it takes a long while to repeat. It is an
ordinary tune of the Audio tab: open it to see how it is made, change it, or press **Calm tune** on a new music
track to get another one (other key, tempo and chords) and make it your own. Projects that already have a
*Theme* keep theirs; *Starter sounds* adds the new one.

### Export (itch.io)

**File > Export game (HTML5 .zip)…** writes a ready-to-upload zip:

```
index.html              the start screen, the project data and the options
player.js               the game itself (no editor code, ~170 KB gzipped)
Inter.woff2             the typeface of the on-screen texts (33 KB)
```

Upload the zip to itch.io as an HTML game (kind of project: *HTML*, tick *This file will be played in the
browser*). It also runs by double-clicking `index.html` (no server needed). The exported page shows a
title, the controls (taken from the project's bindings) and a *Play* button; Esc pauses (and gives the
mouse back), the *Fullscreen* button fills the screen, **M** mutes. Options: show controls, page background color;
the title is the project name.

`player.js` is built by `npm run build:player` (runs automatically before `dev` and `build`).

**The export is trimmed.** Only what the game plays goes into `index.html`: the game objects kept as assets
(Assets > Game objects), models nobody places or wears, textures nothing draws and sounds nothing plays are left
out (the project in the editor is not touched). The default project goes from about 1.2 MB to 0.5 MB.

**Splash screen.** *Project Settings > Splash screen* takes a picture (PNG, JPEG, GIF or WebP) that the exported
game shows full screen when it starts, before the start screen: it fades in, stays for **Stays** seconds on the
**Background** color, and a click, a touch or a key skips it. It is kept inside the project (up to 1280 × 720, bigger
pictures are made smaller). *Preview* shows it. Small pictures are made bigger with hard pixels, so a pixel-art logo
stays sharp.

**Settings for the player.** *Settings* on the start / pause screen lets whoever plays change: volume, mute,
mouse speed (look speed on a phone), invert look up / down, resolution (full, half, third, quarter, for slow
machines) and every key of the controls (click one, press the new key; a key taken from another action swaps
over; Esc, M and 1–4 stay reserved). The choices are kept in the browser (`localStorage`, per game name) and win
over what the author set; *Defaults* forgets them.

**Phones and tablets.** On a touch screen (or with `?touch` in the address) the game shows on-screen controls:
a floating stick on the left half to move, dragging the right half to look, and the buttons *Jump*, *Use*
(interact), *Run*, *Duck*, plus a pause button. Hints say *Use* and *Tap* instead of naming keys.

### Playing

Press **Play**. By default the camera stays **behind the player** and turns with them:

| Input | Behind the player (default) | Free orbit |
| --- | --- | --- |
| W / S, stick up / down | walk forward / backwards along where the player faces | move relative to the camera |
| A / D, stick left / right | turn the player (the camera follows) | move left / right relative to the camera |
| Mouse, right stick | turns the player; vertical movement tilts the camera | orbits the camera |
| Space | jump, **press again in the air for a double jump** | same |
| E (Y on a gamepad) | interact with what is next to the player (signs, levers, characters) | same |

Both are Player settings (select the player in the Level view): **Camera > Mode**, **Movement > Steering speed**
and **Jump > Double jump** (on by default; untick it for a single jump). **Jump > Glide** (off by default) lets the
player float down: let go of jump in the air, then hold it while falling; **Glide fall speed** sets how slowly.
The humanoid shows its `glide` pose (arms out).

A player who leaves the world (off an island, through a hole) is put back at the last checkpoint, or the start, once
they have fallen 30 m below the lowest thing of the level, so a level never needs a net under it.

### Camera navigation (Level and Models, same as Godot's 3D editor)

| Input | Action |
| --- | --- |
| Middle mouse drag | Orbit around the pivot (0.25° per pixel) |
| Shift + middle mouse drag | Pan |
| Ctrl + middle mouse drag | Zoom |
| Mouse wheel / pinch | Zoom (distance × 1.08 per notch) |
| Hold right mouse + **W A S D Q E** | Fly (5 m/s, **Shift** ×3, **Alt** ×0.25, wheel changes the speed) |
| Alt + left mouse (+ Shift / Ctrl) | Orbit / pan / zoom for trackpads ("emulate 3 button mouse") |
| **F** or Numpad **.** | Focus the selection |
| Numpad **1 / 3 / 7** (Ctrl = opposite) | Front / right / top (rear / left / bottom), orthogonal until you orbit |
| Numpad **5** | Perspective / orthogonal |
| Numpad **4 6 8 2**, **9** | Orbit 15°, 180° (Ctrl + 4 6 8 2 pans) |
| Numpad **+ / -** | Zoom |

The "Perspective" menu and the axis gizmo (top right of the view) do the same view switches without a
numpad. While the right button flies the camera, W A S D Q E drive the camera, not the tool shortcuts.

### Finding your way around the editor

- **Shortcut sheet.** The **?** button in the bar over the view (or the **?** key) lists every shortcut; **Esc** closes it.
- **Find an object.** The scene list has a filter ("Find an object…"): it shows only the objects whose name has the
  text in it. Without a filter, a row of three or more objects with the same name (a fence, a trail of coins) is folded
  into one line (*Coin × 24*): click it to open, **Shift + click** to select them all.
- **Wider panels.** Drag the thin divider between the view and the right panel (Level, Models, Animate) to make
  Properties wider (a rule with long text likes it); double-click puts it back. The width is remembered.

### Selecting several objects (Level)

| Input | Action |
| --- | --- |
| Shift / Ctrl+click an object in the view or in the scene list | add it to the selection, or take it out |
| Drag a rectangle over the view | select everything whose center is inside (Shift / Ctrl adds to the selection) |
| Ctrl/Cmd+A | select all objects of the level |
| Ctrl/Cmd+D, Duplicate, Delete | copy or delete all selected (rules of the copies point at the copies) |

The gizmo sits in the middle of the group: **Move** moves them all, **Rotate** turns the group about its
center (each object turns by the same angle), **Scale** spreads the group out and stretches each object. With
several objects selected, Properties offers *Make solid / Not solid* and *Snap to grid* for all of them.
The mesh tools need a single block.

### Painting tiles on faces (Level)

By default a block shows one tile on every face. Choose the **Paint** tool (P) to give single faces their own tile,
Crocotile style: grass on top, dirt on the sides.

- Pick a tile in Properties (any atlas, same picker as for blocks), then **click or drag over faces**.
  The face under the cursor lights up.
- **Shift+click** sets the tile of the whole block and clears its painted faces. **Ctrl/Cmd+click** picks up the
  tile under the cursor as the brush. **Erase** takes a painted tile off a face again.
- **Turn** and **Mirror** change how the picture sits on the face; the tile is still repeated once per meter.
- Painted faces survive mesh tools (an extruded face and its walls keep the tile) and are saved with the project;
  the atlases they use are embedded in the file like those of blocks.
- Painting is one undo step per stroke.

### Terrain (Level)

**+ Add shape… > Terrain (sculptable)** makes a 32 × 32 m field of 1 m cells with the grass tile and switches to the
**Sculpt** tool (G). A terrain is an ordinary block: a grid of quads whose vertices go up and down, so painting a
cell is painting a face, and it is smooth shaded and collided like everything else (the collision is cut into
chunks, so large terrains stay cheap).

| What | How |
| --- | --- |
| Brush | Hold the left mouse over the terrain; the ring shows radius and place. Holding still keeps working. |
| Raise / Lower | Pull the ground up or push it down. |
| Smooth | Evens out bumps. |
| Flatten | Pulls toward the height where the stroke began (flat plateaus, paths). |
| Paint | Lays the chosen tile on every cell inside the ring (*Erase tile* takes it off). |
| Radius, Strength | In Properties. |
| Size | **Width**, **Depth** and **Cell size**, then *Resize terrain* (or *Double*): what you sculpted and painted stays exactly where it is, new ground settles at the level of the old border and carries its paint, a smaller size cuts it off. Undoable. |
| Generate hills | Seed, height and width of rolling hills over the whole terrain (undoable). |
| Flatten all | Back to level ground. |

A terrain is up to 128 × 128 cells (so 128 × 128 m with 1 m cells, more with bigger cells). Stretching it with the
Size field of the block only stretches it (the cells get bigger and it stays sculptable); to get more ground
with the same fine cells use *Size* in the Sculpt panel. If you use the mesh tools (extrude, loop cut, ...) on a
terrain it stops being a grid and can no longer be sculpted; use the Vertex mode of the gizmo for details instead.

### Tool strip and mesh editing (Level and Models share it)

A vertical icon strip on the left edge of the view; a thin row on top holds the view menu, world / local
axes, snap and undo / redo. Hover an icon for its name and shortcut.

| Group | Tool | Key | What it does |
| --- | --- | --- | --- |
| Transform | Select, Move, Rotate, Scale | Q W E R | Drive the gizmo |
| Edit | Object, Face, Vertex | 1 2 3 | What the gizmo acts on (Shift-click adds faces / vertices) |
| Terrain | **Sculpt** | G | Raise, lower, smooth, flatten or paint a terrain with a round brush (see Terrain) |
| Paint | **Paint tiles** | P | Pick a tile in Properties, then click or drag over faces to paint them (see below) |
| Mesh | **Extrude** | T | Pull the selected faces out; the gizmo is aligned to the face normal |
| Mesh | **Inset** | I | Ring of faces around a smaller copy of each selected face (then Scale it) |
| Mesh | **Loop cut** | L | Hover an edge for a preview, click to cut a loop around the mesh |
| Mesh | **Subdivide** | U | Split the selected faces (or everything) into quads |
| Mesh | **Add vertex** | V | Click an edge to split it, then move the new point |
| Mesh | **Merge** | M | Weld the selected vertices into one |
| Mesh | **Bevel** | B | Chamfer every hard edge of the whole shape (width fits its size); stairs, boxes and walls look hewn |
| Mesh | **Smooth** | H | One round of Catmull-Clark subdivision on the whole shape: boxes become soft, rounded forms (press again for rounder) |
| Mesh | **Delete** | Del | Remove the selected faces or vertices |
| Axes | World / Local | X | In Face mode, Local follows the face normal |

- Every block and model shape is a polygon mesh (`core/mesh.ts`): vertices plus faces of 3 or more
  corners. A box is just 8 vertices and 6 quads, so any box can be extruded, cut and pulled into a ramp
  or a boulder. "+ Add shape…" offers Cube, Ramp, **Stairs**, **Arch**, Cylinder, **Cone**, **Sphere**, **Dome**,
  **Ring**, Rock, Plane and Grass tuft as starting points (stairs, arch and the round ones are made by
  `src/core/meshGen.ts`).
- Operations are plain functions on the mesh (tested in `tests/mesh.test.ts`); extruding keeps the
  mesh closed and outward facing, loop cuts follow the ring of quads and fix neighbouring faces.
- Level blocks are textured by repeating one atlas tile per meter, projected along each face's
  dominant axis, so any shape stays textured without UV work. Model shapes have a UV point per face
  corner that you edit in the UV panel.
- **Smooth shading** (a checkbox on blocks and on model shapes): round shapes are lit as one surface instead
  of flat faces; edges sharper than 60° stay sharp. New spheres, domes and rings start smooth.
- **Walking up stairs:** the player steps up edges lower than **Step height** (player settings, 0.4 m) without
  jumping, so modeled stairs and curbs work; steep slopes are still walls.
- Model instances and the player spawn use the same gizmo (move / rotate / scale; the player only
  moves and turns around Y).
- Undo / redo: the level has its own history (Ctrl/Cmd+Z, Shift for redo), the model editor has one per
  model, Paint one for strokes.
- **Collision.** A block (or a model's shape) that is a plain box lined up with the axes (turned in steps
  of 90°) is an exact box: flat-footed, precise for platforming. Everything else (ramps, rocks, blocks
  turned by other angles, edited vertices) is collided as its real triangles. The player is a capsule
  there (radius = half the Width). It walks up ramps and stays on them going down, does not creep on
  a slope while standing, and slides down slopes steeper than **Max slope** (player settings, 50° by
  default) like a wall. Animated model instances keep their rest-pose collision.

## Look

The editor is set in **Inter** (`assets/fonts/Inter.woff2`, a Latin subset, SIL Open Font License; the system
sans-serif font stands in until it has loaded). The on-screen HUD of a running game uses it as well; an export
carries the file along.

## Models, UVs and textures

- A model is a list of cubes and **one texture** (a name). Every cube face has four UV vertices in
  texture pixels, so faces point into a shared atlas like in Blockbench / Crocotile.
- **Models** panel: click a face in the 3D view. Its UV quad shows up over the texture (zoomed onto
  it); drag the four corner points or the whole quad. "Pick tile" maps the face to a clicked tile
  (Shift = all faces). Rotate / flip / reset size / copy to all faces.
- **Paint** edits the *whole* atlas. Every model and level block using it updates live.
- Built-in atlases (`assets/textures`): `Textures-16.png` (the main one, used by the default level),
  `Seamless-16.png` (192 seamless 16 × 16 tiles), and the special ones: `Items-16.png` (pickups),
  `Plants-16.png` (grass and flowers with transparency), `Props-16.png` (80 tiles for the prop models below),
  `Character-*.png` (the skins and templates of the two humanoids),
  `Kit-16.png` (building kit) and `Demo-16.png` (the demo's crystals and ruins).
  Drop any PNG there (name it `Something-16.png` for a 16 px tile size) and it is offered everywhere.
  New blocks and models start on the first atlas whose default tile has pixels in it.
- Textures: built-in atlases live in `assets/textures` (read-only). The first stroke on one copies it
  into the project; a project texture with the same name shadows the built-in one everywhere.
  Textures are stored deflate-compressed in the project JSON.
- Model origin = feet, +Z = front. Placed instances collide per shape: boxes where a shape is a lined up box, triangles otherwise.
- Older projects are migrated on load: per-face bitmaps become one packed texture, and boxes stored as
  size / corner offsets / UV become meshes.

## Roadmap

1. **Skeleton** (done): editor shell, viewport, Play mode, cube player (walk / run / jump / crouch),
   third-person camera, player + project settings, autosave, JSON import/export.
2. **Models + textures** (done): cube models, UV editing, paint mode, assets explorer, model as player.
3. **Level editing** (done): gizmo with object / face / vertex editing, snap, level undo/redo, mesh tools
   (extrude, inset, loop cut, subdivide, add vertex, merge, delete), slope collision, multi-select
   (Shift / Ctrl+click, drag rectangle), tile painting on faces (Paint tool).
4. **Logic** (done): Coin, Key, Apple, Door, Checkpoint, Hazard, Goal, Exit, Moving platform, Sign, variables,
   event → action rules (touch, interact, start, timer, conditions), move / patrol / animate actions, end screen,
   several levels with their own start and sky, HUD, sound effects and music.
5. **Export** (done): standalone HTML5 zip for itch.io, trimmed to what the game plays; settings menu and
   touch controls for the player; chunked and batched drawing for big levels.
6. **Modeled world** (done): building kit and nature as modeled shapes, terrain, enemies and conversations,
   light / shadows / water / low resolution.

Later: collision that follows animated models, more terrain tools (roads, scattering), a prop paint brush,
sound for the player's footsteps by surface.

## Decisions

- Project format is human-readable JSON; game logic is data (events → actions), not a scripting language.
  An optional script component can come later.
- Grid snap by default with free placement available. Shapes are polygon meshes you can edit (extrude, inset, loop cut ...).
- Not a voxel engine: no Minecraft-style cube worlds. Building parts and scenery are modeled shapes; blocky props are
  fine as props.
- Third-person camera, keyboard + mouse and gamepad. English UI.
- Built-in sfxr-style sound generator, plus import.
