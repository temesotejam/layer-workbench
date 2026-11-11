# OrcaSlicer v2.5.0 Web移植・機能別ソース調査

調査日: 2026-11-11  
対象: OrcaSlicer v2.5.0 / Hiosdra/OrcaWasm 現行ソース

## 0. 結論

「OrcaSlicerをそのままWebAssemblyへコンパイル」できない主因は、C++だからではない。OrcaSlicer全体が wxWidgets、デスクトップOpenGL、OSのファイル・ウィンドウ・イベント・プロセス機能などに依存しており、ブラウザには同じ実行環境がないためである。

ただし、アプリ全体をゼロから作り直す必要もない。最も現実的なのは次の分割である。

1. `libslic3r` の計算・モデル・設定・ファイル形式ロジックは、本家C++コードを最大限再利用してWebAssembly化する。
2. `libslic3r_gui` / wxWidgetsのUI層は、ブラウザ向けの表示・入力アダプターへ置き換える。
3. 既存WASM bridgeに足りないAPIを追加し、モデル編集・塗装・テクスチャ・3MFなどの本家機能を呼び出せるようにする。
4. Web版独自の簡易アルゴリズムは避け、可能な限り本家のC++処理を公開する薄いAPIを作る。

現時点のOrcaWasmは「OrcaSlicerのGUIをWeb化したもの」ではなく、「headlessのスライス・プロジェクト処理エンジン」である。従って、現状のままでは本家Prepare画面、各種Gizmo、Design画面、全設定画面の代替にはならない。

## 1. ソース構成と境界

v2.5.0のソース構成で確認した主な境界:

- `src/libslic3r/CMakeLists.txt`: モデル、メッシュ、Arrange、Texture Displacement、Texture Bake、色変換、サポート、3MF、スライス等のC++ソースを列挙。
- `src/slic3r/CMakeLists.txt`: `libslic3r_gui`。3D Scene、GLCanvas、Gizmo、G-code viewer、GUIイベント、ダイアログ等を列挙。
- `src/CMakeLists.txt`: `SLIC3R_GUI` が有効な場合にGUIターゲット、wxWidgets、OpenGL系の依存を組み込む構造。
- OrcaWasmのbuild workflowは `SLIC3R_GUI=OFF` でconfigureし、wxWidgets GUIをビルドしない。

重要: GUIをOFFにしても `libslic3r` の一部機能は残せる。つまり「UI全体は移植が必要」だが「計算機能全体を再実装する必要はない」。

## 2. 機能別の調査結果

難易度の意味:
- A: 既存C++処理をほぼそのままWASMから呼べる見込み
- B: 既存C++処理を流用できるが、bridge/APIやブラウザ側UIが必要
- C: GUI依存が強く、ブラウザ側の入力・描画・状態管理を大きく作る必要
- D: 依存ライブラリ・OS機能・プラグイン等も含め大幅な移植・設計変更が必要

| 機能 | 本家コードの所在・構造 | 現行OrcaWasmで確認できる範囲 | Web移植難易度 |
|---|---|---|---|
| スライス/G-code | `libslic3r`、Print/GCode系 | 主要機能を公開API経由で実行可能 | A/B |
| STL/OBJ/3MF入出力 | `libslic3r/Format`、`Model` | STL/OBJ変換、3MFプロジェクト読込・書出しの一部 | B |
| モデル座標・変換 | `Model.cpp/.hpp` | manifestのmesh/object/instance/transform管理 | B |
| 移動・回転・拡大縮小 | モデル変換ロジック + GUI Gizmo | transform管理は可能。ブラウザの操作UIは未実装 | B/C |
| Arrange / Auto Orient | `ModelArrange.cpp`、`Orient.hpp` | bridgeのprepare操作にArrange/Auto Orientあり | B |
| Lay on Face | メッシュ法線/面選択 + GUI Gizmo | 専用操作APIは未確認 | B/C |
| Split / Cut | `CutUtils`、`GLGizmoCut.cpp`、mesh処理 | 現行APIに専用cut操作なし | B/C |
| Mesh Boolean | `MeshBoolean.cpp`、CGAL、GUI Gizmo | 現行APIに専用Boolean操作なし | B/C |
| Mesh repair / simplify | `MeshRepair.cpp`、CGAL/mesh処理、GUI Gizmo | 既存APIでの完全な編集操作は未確認 | B/C |
| Support painting | `TriangleSelector` + `GLGizmoFdmSupports.cpp` + 3MF保存 | support enforcer/blockerのmodifier volume round-tripは一部対応。面塗装UI/APIは不足 | C |
| Seam painting | `TriangleSelector` + `GLGizmoSeam.cpp` + G-code seam処理 | 専用面塗装APIなし。3MFのseam paint属性も現行bridgeで完全対応を確認できず | C |
| Color painting / MMU segmentation | `GLGizmoMmuSegmentation.cpp`、`TexturePainting.cpp`、`TextureToColor` | 専用編集APIなし | C/D |
| Texture Displacement bake | `TextureDisplacement.cpp`、`TextureBake/*` | C++コア実装は存在するが、現行bridgeに編集/bake APIがない。WASMビルドで全経路が有効かも未検証 | B/C |
| Texture Displacement paint / UV editor / preview | `GLGizmoTextureDisplacement.cpp`、`UVEditorCanvas`、Texture projector等 | デスクトップGUI依存。Web用操作・プレビュー実装なし | C/D |
| Variable layer height | mesh/print処理 + GUI painting tool | 現行APIで専用編集機能を確認できず | B/C |
| G-code preview | `GCodeViewer.cpp`、`GLCanvas3D`、GL renderer | G-code生成APIはあるが本家G-code viewerは含まれない | C |
| Printer/filament/process profiles | `PresetBundle`、Config/Preset | profile init/applyの一部あり。UI、全設定項目・継承・保存動作の同等性は未確認 | B/C |
| 3MF完全互換 | `Format/bbs_3mf.cpp` | native project load/exportと一部modifier保持。全metadata/paint/texture/opaque entryの完全保存は保証されない | B/C |
| Parametric Design/CAD | `libslic3r/CAD/*`、SolveSpace、OCCT。CMakeの`SLIC3R_CAD`条件付き | 現行WASM workflowでCAD機能を有効化している証拠なし。専用APIなし | D |
| Python plugins | GUI/plugin manager + native Python runtime | 現行WASM engineにplugin runtime/APIなし | D |
| Printer network/cloud/device | Bonjour、ネットワーク、USB/serial、native device integration | ブラウザ権限/APIやサーバー連携が別途必要 | D |

## 3. 特に重要な個別機能

### 3.1 Texture Displacementは「計算コア」と「操作UI」が分離できる

v2.5.0の `libslic3r` には以下の実装がある。

- `TextureDisplacement.cpp/.hpp`: texture layer設定、投影、height map、mesh displacement処理
- `TextureBake/TextureBakePipeline.cpp/.hpp`: subdivide、regularize、paint test、relocate、flip、displace、decimate、repair等のbake pipeline
- `TexturePainting.cpp/.hpp`: textured meshからpainted meshへの色/テクスチャ処理（OpenCV依存を含む）
- `Format/bbs_3mf.cpp`: texture displacementのlayer JSON、画像asset、paint maskを3MFへ保存する仕組み

GUI側は `GLGizmoTextureDisplacement.cpp`（約8,947行）に加え、Texture projector、UV editor、preview/bake jobs、GLCanvas、Undo/Redo等に依存する。

従って、Texture DisplacementをWebへ持っていくには:
1. 既存のC++ bake/mesh処理をWASMから呼ぶAPIを作る。
2. PNG/JPEGのdecode・image asset管理・texture layer管理を接続する。
3. face paint mask、projection、UV unwrap/island操作をブラウザUIから編集できるようにする。
4. preview/bake progress/cancelを非同期化する。
5. 3MFにlayer settings、image assets、paint masks、UV編集結果を保存・復元する。
6. bake前/後のgeometryとundo/redoを整合させる。

現行OrcaWasmは `TextureDisplacement` のAPIを公開していない。CMakeにC++ソースが列挙されていることだけで「ブラウザから使える」「全依存経路がWASMで動作する」とは言えない。特にOpenCV依存のTexturePainting/TextureToColorは、WASM buildでの実際のcompile pathと機能有効性を別途検証する。

### 3.2 Support / Seam / Color Paintingは単なる色塗りではない

これらはTriangleSelector等を用いて、三角形/面単位の属性を編集し、スライス時の挙動へ反映する。

- Support painting: enforcer/blockerの領域がsupport generationへ影響。
- Seam painting: seam placementの選好/禁止がG-code seam placementへ影響。
- Color painting: face/regionのmaterial assignmentがmulti-material G-codeへ影響。

必要な作業はブラシ表示だけではない。raycast、face ID選択、brush/sphere/height/fill選択ロジック、paint dataの永続化、3MF round-trip、slice engineへの受け渡しが必要。

現行WASMのmodifierVolumes対応は、support enforcer/blockerの一部であり、これらの面塗装機能全体を意味しない。

### 3.3 3D model manipulationは比較的移植しやすいが、Prepare UIは別

move/rotate/scaleは主としてモデルtransformで表現できる。現行APIのmanifestはinstance transformを扱えるため、データ基盤はある。

しかし本家の操作感を再現するには:
- WebGL viewportとcamera/orbit/pan/zoom
- picking/raycastと選択管理
- gizmo handles、axis snapping、numeric input
- multi-selection、object/part/instance hierarchy
- undo/redo、keyboard shortcuts
- bed/plate/obstacle rendering
- arrange/orient/cut等の各tool state

が必要。ここは独自の3D編集ロジックを発明するのではなく、本家GUIコードから数学・state transitionを抽出し、描画/入力だけWebへ置換するのがよい。

### 3.4 Parametric Design/CADは別の大きな移植プロジェクト

v2.5.0の`libslic3r/CMakeLists.txt`ではCADソースが`if(SLIC3R_CAD)`配下にあり、SolveSpace solverとOCCT ModelingAlgorithmsを必要とする。GUI側にはsketch canvas、constraints、inference、CAD document、tool panelsが必要。OrcaWasmがOCCTを別用途でbuildしていることは、CAD機能を有効化済みという意味ではない。

## 4. なぜデスクトップGUIをそのままWASM化できないか

### wxWidgets / OS integration
GUIはwxWidgetsのwindow、event loop、dialogs、menus、timers、native file picker、webview等を使う。ブラウザDOMはこれらの互換APIではない。wxWidgetsの全GUIを単純にEmscriptenでビルドしても、ブラウザのDOM/入力/フォーカス/IME/ファイルアクセスと完全に同じ動作になるわけではない。

### OpenGL / rendering
OrcaSlicerの3D表示はGLCanvas、GLModel、GLShader、GLGizmos等のデスクトップOpenGL/GLAD経路に密接。EmscriptenにはOpenGL ES/WebGL互換経路があるが、既存のdesktop GL呼び出し、shader、state、texture、framebuffer、context lifecycleを調整する必要がある。wx GL canvasもWebGL canvasへ置換が必要。

### Threading / asynchronous operations
OrcaWasmはpthread/SharedArrayBufferを利用。ブラウザではCOOP/COEPによるcross-origin isolationが必要で、UI main threadで同期blockするとdeadlock/画面停止につながる。engine operationはworker/pthreadに置き、progress/cancelを非同期化する必要がある。

### Filesystem / process / networking
Emscripten virtual FSはC++の通常ファイルAPIの一部を再現できるが、ブラウザのユーザーファイル、IndexedDB永続化、download/export、native process、USB/serial、Bonjour等は別API/permission/hostが必要。

## 5. 最適なアーキテクチャ

「本家C++ロジックを最大限再利用し、UI adapterだけWeb化」を採用する。

### WASM engine層（本家C++）
- slicing / G-code
- model transform / arrange / orient
- mesh repair / cut / boolean / simplify
- support/seam/color paint data operations
- texture displacement / bake / UV operations
- native 3MF import/export
- profile/config operations
- capability introspection

### Browser UI層
- WebGL 3D viewport
- camera, picking, gizmo, selection
- tool panels/settings
- paint brushes and UV editor
- file picker / drag-drop / download / IndexedDB
- undo/redo and keyboard shortcuts
- async progress/cancel

### Bridge/API
現在のone-slicer-api 0.7.0はsession/config/project/slice/asset/exportを中心にしたAPIであり、完全な編集APIではない。編集APIを追加するか、別のversioned host APIを設け、機能ごとにcapabilityを返す。browser UIは機能がsupportedと返された場合のみ表示する。

## 6. 推奨する移植順

1. **Foundation**: model/mesh/transform/3MFのround-trip test、全設定/profile test。
2. **Prepare base**: WebGL viewport、selection、move/rotate/scale、plate、object tree。
3. **Native editing ops**: arrange、orient、lay-on-face、cut、boolean、repairをC++ bridgeへ追加。
4. **Slice UI**: full config panels、slice progress、G-code viewer/preview。
5. **Painting**: support、seam、color paintingと3MF保存/復元。
6. **Texture Displacement**: texture layers、paint mask、UV editor、preview、bake、3MF保存。
7. **Advanced**: CAD/Design、Python plugin、printer/cloud integrations。

## 7. 品質ゲート

機能ごとに以下を比較する:
- 同一入力3MF/STLと同一configでdesktopとWASMのmesh/transform結果が一致する。
- 3MFをWebで開いて編集・保存し、desktopで開いて同じ状態が復元される。
- support/seam/color/texture paint dataが3MF往復で失われない。
- Texture Displacement bakeのmesh topology/geometry、face colors、boundsが一致する。
- 同一設定でG-codeが一致、または差分の理由を定量化・承認する。
- UI操作のUndo/Redoとcancel/progressが破綻しない。

## 8. 現段階で断言できること / できないこと

断言できる:
- OrcaWasmはheadless engineであり、本家GUIを含まない。
- 既存bridgeはslice/project/profile/prepare/exportを中心とし、全GUI editing tool APIを持たない。
- v2.5.0のTexture Displacementには大きなlibslic3r coreと大きなGUI Gizmoがある。
- 本家のGUI層をブラウザへそのまま持ってくるにはwxWidgets/GL/event integrationの置換が必要。
- v2.5.0のCAD機能はoptional CMake featureでSolveSpace/OCCTを要求する。

まだ実証が必要:
- 現行OrcaWasmのWASM artifactにTextureDisplacementの全処理が実際にリンクされているか。
- OpenCV依存のTexturePainting/TextureToColorがどこまでWASMで有効か。
- v2.5.0の各GUI editing core functionをどの範囲でGUI非依存に抽出できるか。
- v2.5.0へ既存patch setを移植したときのcompile/runtime成功率。
- WebGL rendering pathで本家GL codeのどの範囲を再利用できるか。

これらは次の実機能PoCで確定する。現段階で「テクスチャ機能が既存WASMに対応済み」などと表現しない。

## 9. 参照した主なソース・資料

- OrcaSlicer v2.5.0 source: https://github.com/OrcaSlicer/OrcaSlicer/tree/v2.5.0
- libslic3r CMake: https://github.com/OrcaSlicer/OrcaSlicer/blob/v2.5.0/src/libslic3r/CMakeLists.txt
- GUI CMake: https://github.com/OrcaSlicer/OrcaSlicer/blob/v2.5.0/src/slic3r/CMakeLists.txt
- Texture displacement core: https://github.com/OrcaSlicer/OrcaSlicer/blob/v2.5.0/src/libslic3r/TextureDisplacement.cpp
- Texture bake pipeline: https://github.com/OrcaSlicer/OrcaSlicer/tree/v2.5.0/src/libslic3r/TextureBake
- Texture displacement GUI: https://github.com/OrcaSlicer/OrcaSlicer/blob/v2.5.0/src/slic3r/GUI/Gizmos/GLGizmoTextureDisplacement.cpp
- 3MF format: https://github.com/OrcaSlicer/OrcaSlicer/blob/v2.5.0/src/libslic3r/Format/bbs_3mf.cpp
- OrcaWasm: https://github.com/Hiosdra/OrcaWasm
- OrcaWasm bridge: https://github.com/Hiosdra/OrcaWasm/blob/master/bridge/slicer.cpp
- OrcaSlicer Prepare feature index: https://github.com/OrcaSlicer/OrcaSlicer/wiki/
- Texture Displacement guide: https://github.com/OrcaSlicer/OrcaSlicer/wiki/prepare_texture_displacement
- Emscripten pthreads: https://emscripten.org/docs/porting/pthreads.html
- Emscripten OpenGL/WebGL: https://emscripten.org/docs/porting/multimedia_and_graphics/OpenGL-support.html
- Emscripten filesystem: https://emscripten.org/docs/porting/emscripten-runtime-environment.html
