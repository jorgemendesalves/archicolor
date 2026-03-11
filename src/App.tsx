import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Pipette, RotateCcw, Download, Image as ImageIcon, Check, Layers, Search, Loader2, ChevronUp } from 'lucide-react';
import { getMapeiColorByCode, searchMapeiColors, loadMapeiPalette, getGroupedPalette, MapeiColor, ColorFamily } from './services/mapeiPalette';

interface Modification {
  renderIdColor: string; // hex
  targetColor: string; // hex
}

export default function App() {
  const [originalImage, setOriginalImage] = useState<HTMLImageElement | null>(null);
  const [renderIdImage, setRenderIdImage] = useState<HTMLImageElement | null>(null);
  const [selectedRenderColor, setSelectedRenderColor] = useState<string | null>(null);
  const [currentColor, setCurrentColor] = useState<string>('#ffffff');
  const [modifications, setModifications] = useState<Map<string, string>>(new Map());
  const [isPipetteActive, setIsPipetteActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [colorCodeInput, setColorCodeInput] = useState('');
  const [isSearchingColor, setIsSearchingColor] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [mapeiPalette, setMapeiPalette] = useState<MapeiColor[]>([]);
  const [groupedPalette, setGroupedPalette] = useState<ColorFamily[]>([]);
  const [selectedFamilyId, setSelectedFamilyId] = useState<string | null>(null);
  const [selectionMask, setSelectionMask] = useState<Uint8ClampedArray | null>(null);
  const [isToolbarVisible, setIsToolbarVisible] = useState(true);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [showMods, setShowMods] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderIdCanvasRef = useRef<HTMLCanvasElement>(null);
  const originalCanvasRef = useRef<HTMLCanvasElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(event.target as Node)) {
        setIsToolbarVisible(false);
        setIsPaletteOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Load images
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'original' | 'renderId') => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        if (type === 'original') setOriginalImage(img);
        else setRenderIdImage(img);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const rgbToHex = (r: number, g: number, b: number) => {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toLowerCase();
  };

  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
  };

  const colorsMatch = (r1: number, g1: number, b1: number, r2: number, g2: number, b2: number, tolerance: number = 5) => {
    return Math.abs(r1 - r2) <= tolerance && 
           Math.abs(g1 - g2) <= tolerance && 
           Math.abs(b1 - b2) <= tolerance;
  };

  useEffect(() => {
    const initPalette = async () => {
      try {
        const palette = await loadMapeiPalette();
        const grouped = await getGroupedPalette();
        setMapeiPalette(palette);
        setGroupedPalette(grouped);
        if (grouped.length > 0) setSelectedFamilyId(grouped[0].id);
      } catch (error) {
        console.error("Failed to load palette:", error);
      }
    };
    initPalette();
  }, []);

  useEffect(() => {
    if (colorCodeInput.trim()) {
      const normalized = colorCodeInput.trim().toLowerCase();
      const found = mapeiPalette.find(c => c.code.toLowerCase() === normalized);
      if (found && found.familyId) {
        setSelectedFamilyId(found.familyId);
        setCurrentColor(found.hex);
      }
    }
  }, [colorCodeInput, mapeiPalette]);

  useEffect(() => {
    if (isToolbarVisible && searchInputRef.current) {
      // Small delay to ensure the toolbar transition is underway or finished
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  }, [isToolbarVisible]);

  // Process the image based on modifications
  const processImage = useCallback(() => {
    if (!originalImage || !renderIdImage || !canvasRef.current || !renderIdCanvasRef.current || !originalCanvasRef.current) return;

    setIsProcessing(true);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const ridCtx = renderIdCanvasRef.current.getContext('2d', { willReadFrequently: true });
    const origCtx = originalCanvasRef.current.getContext('2d', { willReadFrequently: true });

    if (!ctx || !ridCtx || !origCtx) return;

    const width = originalImage.width;
    const height = originalImage.height;

    // Ensure all canvases are the same size
    canvas.width = width;
    canvas.height = height;
    renderIdCanvasRef.current.width = width;
    renderIdCanvasRef.current.height = height;
    originalCanvasRef.current.width = width;
    originalCanvasRef.current.height = height;

    // Draw source images
    origCtx.drawImage(originalImage, 0, 0);
    ridCtx.drawImage(renderIdImage, 0, 0);

    const originalData = origCtx.getImageData(0, 0, width, height);
    const renderIdData = ridCtx.getImageData(0, 0, width, height);
    const outputData = ctx.createImageData(width, height);

    // Prepare modifications for faster lookup
    const mods = Array.from(modifications.entries()).map(([ridHex, targetHex]) => ({
      rid: hexToRgb(ridHex),
      target: hexToRgb(targetHex)
    }));

    for (let i = 0; i < originalData.data.length; i += 4) {
      const ridR = renderIdData.data[i];
      const ridG = renderIdData.data[i + 1];
      const ridB = renderIdData.data[i + 2];
      
      let target: { r: number, g: number, b: number } | null = null;
      
      // Check if this pixel belongs to any modified Render ID mask
      for (const mod of mods) {
        if (colorsMatch(ridR, ridG, ridB, mod.rid.r, mod.rid.g, mod.rid.b, 2)) {
          target = mod.target;
          break;
        }
      }

      if (target) {
        // Advanced Blending: Preserve texture using luminance
        const r = originalData.data[i];
        const g = originalData.data[i + 1];
        const b = originalData.data[i + 2];
        
        // Calculate relative luminance
        const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

        // Apply color with luminance preservation
        // We use a blend that keeps the target color's character but follows original shading
        outputData.data[i] = Math.min(255, target.r * Math.pow(l, 0.8) * 1.1);
        outputData.data[i + 1] = Math.min(255, target.g * Math.pow(l, 0.8) * 1.1);
        outputData.data[i + 2] = Math.min(255, target.b * Math.pow(l, 0.8) * 1.1);
        outputData.data[i + 3] = 255;
      } else {
        outputData.data[i] = originalData.data[i];
        outputData.data[i + 1] = originalData.data[i + 1];
        outputData.data[i + 2] = originalData.data[i + 2];
        outputData.data[i + 3] = originalData.data[i + 3];
      }

      // Apply selection highlight if mask exists
      if (selectionMask && selectionMask[i / 4] > 0) {
        // Add a subtle cyan tint to the selected area
        outputData.data[i] = outputData.data[i] * 0.7 + 0 * 0.3;
        outputData.data[i + 1] = outputData.data[i + 1] * 0.7 + 255 * 0.3;
        outputData.data[i + 2] = outputData.data[i + 2] * 0.7 + 255 * 0.3;
      }
    }

    ctx.putImageData(outputData, 0, 0);
    setIsProcessing(false);
  }, [originalImage, renderIdImage, modifications, selectionMask]);

  useEffect(() => {
    if (originalImage && renderIdImage) {
      processImage();
    }
  }, [originalImage, renderIdImage, modifications, processImage]);

  const selectElementByColor = useCallback((hex: string) => {
    if (!renderIdCanvasRef.current || !originalImage) return;

    const ridCtx = renderIdCanvasRef.current.getContext('2d', { willReadFrequently: true });
    if (!ridCtx) return;

    const rgb = hexToRgb(hex);
    setSelectedRenderColor(hex);

    // Generate Mask based on Render ID
    const width = originalImage.width;
    const height = originalImage.height;
    const renderIdData = ridCtx.getImageData(0, 0, width, height).data;
    const mask = new Uint8ClampedArray(width * height);

    for (let i = 0; i < renderIdData.length; i += 4) {
      if (colorsMatch(renderIdData[i], renderIdData[i+1], renderIdData[i+2], rgb.r, rgb.g, rgb.b, 2)) {
        mask[i / 4] = 255;
      } else {
        mask[i / 4] = 0;
      }
    }
    setSelectionMask(mask);

    const existingMod = modifications.get(hex);
    if (existingMod) {
      setCurrentColor(existingMod);
      const mapeiMatch = mapeiPalette.find(c => c.hex === existingMod);
      if (mapeiMatch) {
        setColorCodeInput(mapeiMatch.code);
        if (mapeiMatch.familyId) setSelectedFamilyId(mapeiMatch.familyId);
      }
      else setColorCodeInput('');
    } else {
      // Default to white if no mod exists
      setCurrentColor('#ffffff');
      setColorCodeInput('');
    }
    setIsPipetteActive(false);
    setIsToolbarVisible(true);
  }, [originalImage, modifications, mapeiPalette]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isPipetteActive || !renderIdCanvasRef.current || !originalImage) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.floor((e.clientX - rect.left) * scaleX);
    const y = Math.floor((e.clientY - rect.top) * scaleY);

    const ridCtx = renderIdCanvasRef.current.getContext('2d', { willReadFrequently: true });
    if (!ridCtx) return;

    const pixel = ridCtx.getImageData(x, y, 1, 1).data;
    const hex = rgbToHex(pixel[0], pixel[1], pixel[2]);
    
    selectElementByColor(hex);
  };

  const applyColorChange = () => {
    if (!selectedRenderColor) return;
    const newMods = new Map(modifications);
    newMods.set(selectedRenderColor, currentColor);
    setModifications(newMods);
    setSelectionMask(null); // Clear highlight after applying
  };

  const resetModifications = () => {
    setModifications(new Map());
    setSelectedRenderColor(null);
    setSelectionMask(null);
    setColorCodeInput('');
  };

  const searchMapeiColor = async () => {
    if (!colorCodeInput.trim()) return;
    
    setIsSearchingColor(true);
    setSearchError(null);
    try {
      const color = await getMapeiColorByCode(colorCodeInput);
      
      if (color) {
        setCurrentColor(color.hex);
        if (color.familyId) setSelectedFamilyId(color.familyId);
      } else {
        setSearchError("Color not found in Mapei catalog");
      }
    } catch (error) {
      console.error("Error searching color:", error);
      setSearchError("Search failed. Please try again.");
    } finally {
      setIsSearchingColor(false);
    }
  };

  const exportImage = () => {
    if (!canvasRef.current) return;
    const link = document.createElement('a');
    link.download = 'edited-render.png';
    link.href = canvasRef.current.toDataURL('image/png');
    link.click();
  };

  return (
    <div className="h-screen w-screen bg-[#0f1115] text-[#e6e8ee] font-sans selection:bg-[#6b7cff] selection:text-white overflow-hidden flex flex-col">
      {/* Top Bar */}
      <header className="absolute top-0 left-0 right-0 z-20 p-6 flex justify-between items-center pointer-events-none">
        <div className="pointer-events-auto">
          <h1 className="text-2xl font-sans font-bold tracking-tight text-[#e6e8ee]">Archicolor</h1>
          <p className="text-[10px] uppercase tracking-[0.3em] text-[#6b7cff] font-bold mt-1">Render ID Material Editor</p>
        </div>
        
        <div className="flex gap-3 pointer-events-auto">
          <button 
            onClick={() => setShowMods(!showMods)}
            className={`p-3 rounded-full backdrop-blur-md border transition-all ${showMods ? 'bg-[#6b7cff] border-[#6b7cff] text-white' : 'bg-[#141419]/80 border-white/10 text-[#e6e8ee] hover:bg-[#141419]'}`}
            title="Active Modifications"
          >
            <Layers size={20} />
          </button>
          <button 
            onClick={resetModifications}
            className="p-3 rounded-full bg-[#141419]/80 backdrop-blur-md border border-white/10 text-[#e6e8ee] hover:bg-[#141419] transition-all"
            title="Reset All"
          >
            <RotateCcw size={20} />
          </button>
          <button 
            onClick={exportImage}
            disabled={!originalImage}
            className="flex items-center gap-2 px-6 py-3 bg-[#6b7cff] text-white rounded-full hover:bg-[#5a6aff] transition-all shadow-lg shadow-[#6b7cff]/20 disabled:opacity-30 disabled:pointer-events-none font-bold text-sm uppercase tracking-widest"
          >
            <Download size={18} /> Export
          </button>
        </div>
      </header>

      {/* Main Viewport */}
      <main className="relative flex-1 w-full h-full flex items-center justify-center bg-[#0a0c10]">
        {(!originalImage || !renderIdImage) ? (
          <div className="max-w-xl w-full p-16 rounded-3xl bg-[#141419]/50 backdrop-blur-xl border border-white/5 flex flex-col items-center text-center shadow-2xl">
            <div className="w-20 h-20 rounded-2xl bg-[#6b7cff]/10 flex items-center justify-center mb-8">
              <ImageIcon size={40} className="text-[#6b7cff]" />
            </div>
            <h2 className="text-3xl font-sans font-bold mb-4 text-white">Start your project</h2>
            <p className="text-[#e6e8ee]/60 mb-12 max-w-sm leading-relaxed">Upload your original render and its Render ID mask to begin the material editing workflow.</p>
            
            <div className="grid grid-cols-2 gap-6 w-full">
              <label className="group relative flex flex-col items-center gap-4 p-8 rounded-2xl bg-white/5 border border-white/10 cursor-pointer hover:bg-white/10 hover:border-[#6b7cff]/50 transition-all">
                <div className="p-4 rounded-xl bg-white/5 group-hover:bg-[#6b7cff]/20 transition-colors">
                  <Upload size={24} className="text-[#e6e8ee] group-hover:text-[#6b7cff]" />
                </div>
                <span className="text-xs uppercase tracking-widest font-bold opacity-70 group-hover:opacity-100">Original Render</span>
                <input type="file" className="hidden" onChange={(e) => handleImageUpload(e, 'original')} accept="image/*" />
                {originalImage && <div className="absolute top-4 right-4 text-[#6b7cff]"><Check size={20} /></div>}
              </label>
              
              <label className="group relative flex flex-col items-center gap-4 p-8 rounded-2xl bg-white/5 border border-white/10 cursor-pointer hover:bg-white/10 hover:border-[#6b7cff]/50 transition-all">
                <div className="p-4 rounded-xl bg-white/5 group-hover:bg-[#6b7cff]/20 transition-colors">
                  <Layers size={24} className="text-[#e6e8ee] group-hover:text-[#6b7cff]" />
                </div>
                <span className="text-xs uppercase tracking-widest font-bold opacity-70 group-hover:opacity-100">Render ID Mask</span>
                <input type="file" className="hidden" onChange={(e) => handleImageUpload(e, 'renderId')} accept="image/*" />
                {renderIdImage && <div className="absolute top-4 right-4 text-[#6b7cff]"><Check size={20} /></div>}
              </label>
            </div>
          </div>
        ) : (
          <div className="relative w-full h-full flex items-center justify-center p-4">
            <canvas 
              ref={canvasRef} 
              onClick={handleCanvasClick}
              className={`max-w-full max-h-full shadow-[0_0_100px_rgba(0,0,0,0.5)] transition-all duration-500 ${isPipetteActive ? 'cursor-crosshair scale-[1.01]' : 'cursor-default'}`}
            />
            {isProcessing && (
              <div className="absolute inset-0 bg-[#0f1115]/40 backdrop-blur-md flex flex-col items-center justify-center z-30">
                <Loader2 size={48} className="text-[#6b7cff] animate-spin mb-4" />
                <div className="text-xs uppercase tracking-[0.4em] font-bold text-[#6b7cff]">Processing Mask</div>
              </div>
            )}
          </div>
        )}
        
        {/* Hidden helper canvases */}
        <canvas ref={renderIdCanvasRef} className="hidden" />
        <canvas ref={originalCanvasRef} className="hidden" />

        {/* Floating Modifications Sidebar */}
        {showMods && (
          <div className="absolute top-24 right-6 w-72 max-h-[60vh] bg-[#141419]/90 backdrop-blur-xl border border-white/10 rounded-3xl p-6 shadow-2xl z-20 overflow-hidden flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-[#6b7cff]">Active Changes</h3>
              <span className="bg-[#6b7cff]/20 text-[#6b7cff] text-[10px] px-2 py-0.5 rounded-full font-bold">{modifications.size}</span>
            </div>
            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
              {Array.from(modifications.entries()).map(([rid, target]) => (
                <div 
                  key={rid} 
                  onClick={() => selectElementByColor(rid)}
                  className={`group flex items-center justify-between p-3 rounded-xl bg-white/5 border mb-2 hover:bg-white/10 transition-all cursor-pointer ${selectedRenderColor === rid ? 'border-[#6b7cff]/50 bg-white/10' : 'border-white/5'}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                      <div className="w-4 h-4 rounded-sm border border-white/10" style={{ backgroundColor: rid }}></div>
                      <span className="text-[#e6e8ee]/40">→</span>
                      <div className="w-4 h-4 rounded-sm border border-white/10" style={{ backgroundColor: target }}></div>
                    </div>
                  </div>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      const next = new Map(modifications);
                      next.delete(rid);
                      setModifications(next);
                      if (selectedRenderColor === rid) {
                        setSelectedRenderColor(null);
                        setSelectionMask(null);
                      }
                    }}
                    className="text-[10px] font-bold text-red-400/50 group-hover:text-red-400 transition-colors uppercase tracking-tighter"
                  >
                    Remove
                  </button>
                </div>
              ))}
              {modifications.size === 0 && (
                <div className="flex flex-col items-center justify-center py-12 opacity-20">
                  <Layers size={32} className="mb-2" />
                  <p className="text-[10px] uppercase tracking-widest">No changes applied</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Floating Bottom Toolbar & Palette */}
        {originalImage && renderIdImage && (
          <div 
            ref={toolbarRef}
            className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full flex flex-col items-center z-40 pointer-events-none"
          >
            {/* Palette Overlay (Popup) */}
            {selectedRenderColor && isPaletteOpen && (
              <div className={`w-full max-w-2xl px-4 mb-6 transition-all duration-500 ${isToolbarVisible ? 'translate-y-0 opacity-100' : 'translate-y-12 opacity-0'}`}>
                <div className="bg-[#141419]/95 backdrop-blur-xl border border-white/10 rounded-2xl p-5 shadow-2xl pointer-events-auto relative">
                  {/* Arrow */}
                  <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-[#141419] border-r border-b border-white/10 rotate-45"></div>
                  
                  <div className="flex justify-between items-center mb-4">
                    <div className="flex flex-col">
                      <span className="text-[8px] uppercase tracking-[0.2em] font-bold text-[#6b7cff]">Mapei Master Collection</span>
                      <span className="text-[10px] text-white/40 font-medium">Browse by color family</span>
                    </div>
                    <button 
                      onClick={() => setIsPaletteOpen(false)}
                      className="text-[10px] uppercase tracking-widest font-bold opacity-40 hover:opacity-100 transition-opacity bg-white/5 px-3 py-1 rounded-full"
                    >
                      Close
                    </button>
                  </div>

                  {/* Family Tabs */}
                  <div className="flex items-center gap-1.5 mb-5 overflow-x-auto pb-2 custom-scrollbar no-scrollbar">
                    {groupedPalette.map(family => (
                      <button
                        key={family.id}
                        onClick={() => setSelectedFamilyId(family.id)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all whitespace-nowrap ${selectedFamilyId === family.id ? 'bg-white/10 border-[#6b7cff] text-white' : 'bg-white/5 border-white/5 text-white/40 hover:bg-white/10'}`}
                      >
                        <div className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ backgroundColor: family.hex }}></div>
                        <span className="text-[9px] uppercase tracking-wider font-bold">{family.label}</span>
                      </button>
                    ))}
                  </div>
                  
                  {/* Variants Grid */}
                  <div className="max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                    <div className="grid grid-cols-12 gap-1.5">
                      {groupedPalette.find(f => f.id === selectedFamilyId)?.variants.map(c => (
                        <button 
                          key={c.code}
                          onClick={() => {
                            setCurrentColor(c.hex);
                            setColorCodeInput(c.code);
                          }}
                          className={`aspect-square rounded-md border transition-all hover:scale-110 relative group ${currentColor === c.hex ? 'border-white ring-2 ring-[#6b7cff] z-10' : 'border-white/5'}`}
                          style={{ backgroundColor: c.hex }}
                        >
                          <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-[#0f1115] text-white text-[7px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 border border-white/10 shadow-xl">
                            {c.code}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Toolbar */}
            <div 
              className="h-24 flex items-center justify-center pb-8 w-full"
              onMouseEnter={() => setIsToolbarVisible(true)}
            >
              <div 
                className={`bg-[#141419]/90 backdrop-blur-2xl border border-white/10 rounded-full px-1.5 py-1.5 shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex items-center gap-1.5 transition-all duration-500 transform pointer-events-auto ${isToolbarVisible ? 'translate-y-0 opacity-100' : 'translate-y-24 opacity-0'}`}
              >
                {/* Selection Trigger */}
                <button 
                  onClick={() => setIsPipetteActive(!isPipetteActive)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full transition-all ${isPipetteActive ? 'bg-[#6b7cff] text-white shadow-lg shadow-[#6b7cff]/30' : 'hover:bg-white/5 text-[#e6e8ee]'}`}
                >
                  <Pipette size={16} className={isPipetteActive ? 'animate-pulse' : ''} />
                  <span className="text-[10px] uppercase tracking-widest font-bold">
                    {isPipetteActive ? 'Selecting...' : 'Select'}
                  </span>
                </button>

                {selectedRenderColor && (
                  <>
                    <div className="w-px h-6 bg-white/10 mx-0.5"></div>
                    
                    {/* Mask Info */}
                    <div className="flex items-center gap-2 px-2">
                      <div className="w-5 h-5 rounded-full border border-white/20 shadow-inner" style={{ backgroundColor: selectedRenderColor }}></div>
                      <div className="flex flex-col">
                        <span className="text-[7px] uppercase tracking-widest opacity-40 font-bold">Mask</span>
                        <span className="text-[9px] font-mono text-[#6b7cff]">{selectedRenderColor}</span>
                      </div>
                    </div>

                    <div className="w-px h-6 bg-white/10 mx-0.5"></div>

                    {/* Color Picker */}
                    <div className="flex items-center gap-3 px-2">
                      <div className="relative group flex items-center gap-2">
                        <button 
                          onClick={() => setIsPaletteOpen(!isPaletteOpen)}
                          className={`w-8 h-8 rounded-full border-2 transition-all shadow-inner ${isPaletteOpen ? 'border-[#6b7cff] scale-110' : 'border-white/20'}`}
                          style={{ backgroundColor: currentColor }}
                          title="Open Mapei Palette"
                        />
                        <input 
                          type="color" 
                          value={currentColor}
                          onChange={(e) => setCurrentColor(e.target.value)}
                          className="w-4 h-4 rounded-full cursor-pointer border border-white/20 bg-transparent p-0 overflow-hidden opacity-40 hover:opacity-100 transition-opacity"
                          title="Custom Color Picker"
                        />
                        <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-[#141419] border border-white/10 px-2 py-1 rounded text-[9px] font-mono opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                          {currentColor}
                        </div>
                      </div>

                      {/* Mapei Search */}
                      <div className="flex items-center gap-1.5 bg-white/5 rounded-full px-3 py-1 border border-white/5 focus-within:border-[#6b7cff]/50 transition-all">
                        <Search size={12} className="opacity-40" />
                        <input 
                          ref={searchInputRef}
                          type="text" 
                          placeholder="Mapei"
                          value={colorCodeInput}
                          onKeyDown={(e) => e.key === 'Enter' && searchMapeiColor()}
                          onChange={(e) => {
                            const val = e.target.value;
                            setColorCodeInput(val);
                            const found = mapeiPalette.find(c => c.code.toLowerCase() === val.trim().toLowerCase());
                            if (found) setCurrentColor(found.hex);
                          }}
                          className="bg-transparent border-none text-[10px] font-mono w-16 focus:outline-none placeholder:opacity-20"
                        />
                      </div>
                    </div>

                    <div className="w-px h-6 bg-white/10 mx-0.5"></div>

                    {/* Apply Button */}
                    <button 
                      onClick={applyColorChange}
                      className="flex items-center gap-1.5 px-6 py-2 bg-white text-[#0f1115] rounded-full hover:bg-[#6b7cff] hover:text-white transition-all font-bold text-[10px] uppercase tracking-widest"
                    >
                      <Check size={16} /> Apply
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Toolbar Indicator (Visible when hidden) */}
        {originalImage && renderIdImage && !isToolbarVisible && (
          <div 
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 cursor-pointer animate-bounce flex flex-col items-center group"
            onMouseEnter={() => setIsToolbarVisible(true)}
          >
            <div className="bg-[#6b7cff] w-12 h-1.5 rounded-full mb-2 shadow-[0_0_15px_rgba(107,124,255,0.5)] transition-all group-hover:w-16"></div>
            <ChevronUp size={20} className="text-[#6b7cff] drop-shadow-[0_0_8px_rgba(107,124,255,0.8)]" />
            <span className="text-[8px] uppercase tracking-[0.2em] font-bold text-[#6b7cff] mt-1 opacity-0 group-hover:opacity-100 transition-opacity">Tools</span>
          </div>
        )}
      </main>
    </div>
  );
}

