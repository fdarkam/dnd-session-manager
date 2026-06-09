import { useState, useEffect, useRef } from 'react';

// ★ Pivot — déclare TOUS les refs + states + les 24 effets de synchro refs↔state.
// Ces refs sont des singletons partagés PAR RÉFÉRENCE : tous les autres hooks/modules
// les reçoivent en argument et ne refont JAMAIS useRef() pour ces données.
export function useMapRefs(isDM) {
  const canvasRef = useRef(null);
  const cursorCanvasRef = useRef(null); // Canvas dédié aux curseurs — positionné après les tokens dans le DOM
  const containerRef = useRef(null);

  // ── Operation flags ──
  const fogPainting = useRef(false);
  const eraserActive = useRef(false);
  const resizingToken = useRef(null);
  const dragMoved = useRef(false);
  const lastDragEmit = useRef(0);
  const lastCursorEmit = useRef(0);
  const lastDrawEmit = useRef(0);
  const lastFogEmit = useRef(0);
  const lastImgTransformEmit = useRef(0); // Feature 2 — throttle du broadcast live image transform
  const panStartRef = useRef({ x: 0, y: 0 }); // avoids re-renders during panning
  const pingAnimRef = useRef([]);
  const lerpAnimRef = useRef(null);
  const tokenLastClickRef = useRef({ id: null, time: 0 });
  const fetchMapsRef = useRef(null);
  // Sync flags — updated synchronously so mousemove handlers are never stale
  const isDrawingRef = useRef(false);
  const isPanningRef = useRef(false);
  const isDraggingRef = useRef(null);  // stores the token object being dragged

  // ── Draw data refs (always fresh for synchronous drawFrame calls) ──
  const tokensRef = useRef([]);
  const tokenVisualsRef = useRef({});   // interpolated display positions per token id
  const tokenLerpsRef = useRef({});   // active lerp jobs { fromX,fromY,toX,toY,startTime,duration }
  const cursorVisualsRef = useRef({});   // interpolated cursor positions { userId: {x,y} }
  const cursorLerpsRef = useRef({});   // cursor lerp jobs (same shape as tokenLerpsRef)
  const pathsRef = useRef([]);
  const livePathsRef = useRef({});   // other users' in-progress strokes { pathId: {color,width,points[]} }
  const currentPathRef = useRef([]);
  const currentPathIdRef = useRef(null); // id shared with finalized path
  // Fix 2 : selectedTokenRef est local à ce client — il ne doit JAMAIS être broadcasté via socket
  const selectedTokenRef = useRef(null);
  const panOffsetRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const mapImageRef = useRef(null);
  const imgXRef = useRef(0);
  const imgYRef = useRef(0);
  const imgScaleRef = useRef(1);
  const gridSizeRef = useRef(40);
  const drawColorRef = useRef('#ef4444');
  const drawWidthRef = useRef(2);
  const fogColorRef = useRef('#000000');
  const fogOpacityRef = useRef(0.85);
  const fogCellsRef = useRef(new Set());
  const fogBrushPxRef = useRef(40);
  const isDMRef = useRef(isDM);
  const activeMapRef = useRef(null);
  const otherCursorsRef = useRef({});
  const toolRef = useRef('move');
  const copiedTokenRef = useRef(null);   // token copié via Ctrl+C
  const mouseWorldPosRef = useRef({ x: 0, y: 0 }); // position monde courante de la souris
  const undoStackRef = useRef([]);       // pile d'annulation (max 20 entrées)
  const redoStackRef = useRef([]);       // pile de rétablissement
  // ── Formes de sorts ──
  const shapesRef = useRef([]);          // formes sauvegardées
  const currentShapeRef = useRef(null); // forme en cours de dessin (preview live)
  const selectedShapeRef = useRef(null); // forme actuellement sélectionnée
  const isDrawingShapeRef = useRef(false);
  const isDraggingShapeRef = useRef(null);           // drag d'une forme sélectionnée
  const isResizingShapeRef = useRef(false);          // redimensionnement d'une forme en cours
  const activeHandleRef = useRef(null);              // poignée de resize active { id: ... }
  const lastShapeDragEmit = useRef(0);               // throttle broadcast drag/resize forme
  const shapeLastClickRef = useRef({ id: null, time: 0 }); // détection double clic
  const shapeTypeRef = useRef('circle');
  const shapeColorRef = useRef('#e74c3c');
  const shapeWidthRef = useRef(2);
  const shapeFilledRef = useRef(true);
  const shapeOpacityRef = useRef(0.5);
  // ── Fog simplifié — un seul état : fogCellsRef (peint par le MJ) ──
  const lastFogUpdateRef = useRef(0); // throttle du recalcul fog pendant drag (50ms)
  // ── React state (drives re-render / UI only) ──
  const [maps, setMaps] = useState([]);
  const [activeMap, setActiveMap] = useState(null);
  const [mapImage, setMapImage] = useState(null);
  const [imgX, setImgX] = useState(0);
  const [imgY, setImgY] = useState(0);
  const [imgScale, setImgScale] = useState(1);
  const [tokens, setTokens] = useState([]);
  const [paths, setPaths] = useState([]);
  const [fogCells, setFogCells] = useState(new Set());
  const [tool, setTool] = useState('move');
  const [gridSize, setGridSize] = useState(40);
  const [drawColor, setDrawColor] = useState('#ef4444');
  const [drawWidth, setDrawWidth] = useState(2);
  const [eraserSize, setEraserSize] = useState(20);
  const [fogBrushPx, setFogBrushPx] = useState(40);
  const [fogColor, setFogColor] = useState('#000000');
  const [fogOpacity, setFogOpacity] = useState(0.85);
  // Toggle visibilité de la grille
  const [showGrid, setShowGrid] = useState(true);
  const showGridRef = useRef(true);
  const [drawing, setDrawing] = useState(false);
  const [dragging, setDragging] = useState(null);
  const [editingMapImg, setEditingMapImg] = useState(null);
  const [isPanning, setIsPanning] = useState(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null); // { type: 'token'|'map-image', id? }
  const [zoom, setZoom] = useState(1);
  const [selectedToken, setSelectedToken] = useState(null);
  const [showTokenEdit, setShowTokenEdit] = useState(false);
  const [showDice, setShowDice] = useState(false);
  const [showCombat, setShowCombat] = useState(false);
  const [editingMapName, setEditingMapName] = useState(null); // Feature 5 — null = pas en édition, string = en cours
  const [newTokenName, setNewTokenName] = useState('');
  const [newTokenColor, setNewTokenColor] = useState('#c9a84c');
  const [newTokenBorderColor, setNewTokenBorderColor] = useState('#ffffff');
  const [newTokenRadius, setNewTokenRadius] = useState(20);
  const newTokenFileRef = useRef();
  const prevMapIdRef = useRef(null); // garde contre rechargement de map sur simple rename
  const tokenWorldRef = useRef(null); // overlay transform (sync pan/zoom canvas)
  const tokenDivsRef = useRef({});   // map id→div pour updates impératifs pendant lerp
  const mapWorldRef = useRef(null);  // div transform pour la map HTML (même espace que tokenWorld)
  const mapImgElemRef = useRef(null); // <img> DOM de la map background
  const [newTokenImage, setNewTokenImage] = useState(null);
  const [newTokenHidden, setNewTokenHidden] = useState(false);
  const [tokenEditPos, setTokenEditPos] = useState(null); // position initiale du panneau d'édition de token
  // ── Formes de sorts ──
  const [shapes, setShapes] = useState([]);
  const [selectedShape, setSelectedShape] = useState(null);
  const [shapeType, setShapeType] = useState('circle');
  const [shapeColor, setShapeColor] = useState('#e74c3c');
  const [shapeWidth, setShapeWidth] = useState(2);
  const [shapeFilled, setShapeFilled] = useState(true);
  const [shapeOpacity, setShapeOpacity] = useState(0.5);
  const [newShapeName, setNewShapeName] = useState(''); // Fix 4 — nom de la nouvelle forme
  const [renamingShape, setRenamingShape] = useState(null); // Fix 5 — renommage inline
  const [tokenInfo, setTokenInfo] = useState(null); // fenêtre info token au double clic (lecture seule)

  // ── Keep refs in sync with state ──
  useEffect(() => { if (!isDraggingRef.current) tokensRef.current = tokens; }, [tokens]);
  useEffect(() => { pathsRef.current = paths; }, [paths]);
  useEffect(() => { panOffsetRef.current = panOffset; }, [panOffset]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { mapImageRef.current = mapImage; }, [mapImage]);
  useEffect(() => { imgXRef.current = imgX; imgYRef.current = imgY; imgScaleRef.current = imgScale; }, [imgX, imgY, imgScale]);
  useEffect(() => { gridSizeRef.current = gridSize; }, [gridSize]);
  useEffect(() => { drawColorRef.current = drawColor; }, [drawColor]);
  useEffect(() => { drawWidthRef.current = drawWidth; }, [drawWidth]);
  useEffect(() => { fogColorRef.current = fogColor; }, [fogColor]);
  useEffect(() => { fogOpacityRef.current = fogOpacity; }, [fogOpacity]);
  useEffect(() => { fogBrushPxRef.current = fogBrushPx; }, [fogBrushPx]);
  useEffect(() => { fogCellsRef.current = fogCells; }, [fogCells]);
  useEffect(() => { isDMRef.current = isDM; }, [isDM]);
  useEffect(() => { activeMapRef.current = activeMap; }, [activeMap]);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { selectedTokenRef.current = selectedToken; }, [selectedToken]);
  useEffect(() => { shapesRef.current = shapes; }, [shapes]);
  useEffect(() => { shapeTypeRef.current = shapeType; }, [shapeType]);
  useEffect(() => { shapeColorRef.current = shapeColor; }, [shapeColor]);
  useEffect(() => { shapeWidthRef.current = shapeWidth; }, [shapeWidth]);
  useEffect(() => { shapeFilledRef.current = shapeFilled; }, [shapeFilled]);
  useEffect(() => { shapeOpacityRef.current = shapeOpacity; }, [shapeOpacity]);
  useEffect(() => { selectedShapeRef.current = selectedShape; }, [selectedShape]);

  const refs = { canvasRef, cursorCanvasRef, containerRef, fogPainting, eraserActive, resizingToken, dragMoved, lastDragEmit, lastCursorEmit, lastDrawEmit, lastFogEmit, lastImgTransformEmit, panStartRef, pingAnimRef, lerpAnimRef, tokenLastClickRef, fetchMapsRef, isDrawingRef, isPanningRef, isDraggingRef, tokensRef, tokenVisualsRef, tokenLerpsRef, cursorVisualsRef, cursorLerpsRef, pathsRef, livePathsRef, currentPathRef, currentPathIdRef, selectedTokenRef, panOffsetRef, zoomRef, mapImageRef, imgXRef, imgYRef, imgScaleRef, gridSizeRef, drawColorRef, drawWidthRef, fogColorRef, fogOpacityRef, fogCellsRef, fogBrushPxRef, isDMRef, activeMapRef, otherCursorsRef, toolRef, copiedTokenRef, mouseWorldPosRef, undoStackRef, redoStackRef, shapesRef, currentShapeRef, selectedShapeRef, isDrawingShapeRef, isDraggingShapeRef, isResizingShapeRef, activeHandleRef, lastShapeDragEmit, shapeLastClickRef, shapeTypeRef, shapeColorRef, shapeWidthRef, shapeFilledRef, shapeOpacityRef, lastFogUpdateRef, showGridRef, newTokenFileRef, prevMapIdRef, tokenWorldRef, tokenDivsRef, mapWorldRef, mapImgElemRef };
  const state = { maps, activeMap, mapImage, imgX, imgY, imgScale, tokens, paths, fogCells, tool, gridSize, drawColor, drawWidth, eraserSize, fogBrushPx, fogColor, fogOpacity, showGrid, drawing, dragging, editingMapImg, isPanning, panOffset, showDeleteConfirm, pendingDelete, zoom, selectedToken, showTokenEdit, showDice, showCombat, editingMapName, newTokenName, newTokenColor, newTokenBorderColor, newTokenRadius, newTokenImage, newTokenHidden, tokenEditPos, shapes, selectedShape, shapeType, shapeColor, shapeWidth, shapeFilled, shapeOpacity, newShapeName, renamingShape, tokenInfo };
  const setters = { setMaps, setActiveMap, setMapImage, setImgX, setImgY, setImgScale, setTokens, setPaths, setFogCells, setTool, setGridSize, setDrawColor, setDrawWidth, setEraserSize, setFogBrushPx, setFogColor, setFogOpacity, setShowGrid, setDrawing, setDragging, setEditingMapImg, setIsPanning, setPanOffset, setShowDeleteConfirm, setPendingDelete, setZoom, setSelectedToken, setShowTokenEdit, setShowDice, setShowCombat, setEditingMapName, setNewTokenName, setNewTokenColor, setNewTokenBorderColor, setNewTokenRadius, setNewTokenImage, setNewTokenHidden, setTokenEditPos, setShapes, setSelectedShape, setShapeType, setShapeColor, setShapeWidth, setShapeFilled, setShapeOpacity, setNewShapeName, setRenamingShape, setTokenInfo };
  return { refs, state, setters };
}
