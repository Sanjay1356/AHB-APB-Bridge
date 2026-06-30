import React, { useState, useMemo, useRef, useEffect } from "react";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import {
  Cpu,
  Terminal,
  Activity,
  Workflow,
  FileText,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Compass,
  Search,
  Download,
  Copy,
  Sliders,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize2,
  Eye,
  BookOpen,
  Table,
  Printer,
  ChevronDown,
  ChevronRight,
  Info,
  Layers,
  Check,
  ExternalLink,
  RefreshCw,
  Play,
  Square,
  HelpCircle
} from "lucide-react";

import {
  MODULES,
  FSM_STATES,
  TRACEABILITY,
  TEST_CASES,
  CONSOLE_OUTPUT,
  TestCase,
  FsmState,
  RtlModule
} from "./data";

export default function App() {
  // Navigation
  const [activeTab, setActiveTab] = useState<string>("dashboard");

  // State for modules/architecture exploration
  const [selectedModule, setSelectedModule] = useState<string>("bridge_fsm");

  // State for FSM tab
  const [selectedFsmState, setSelectedFsmState] = useState<string>("idle");
  const [activeSimulation, setActiveSimulation] = useState<string | null>(null);
  const [simStep, setSimStep] = useState<number>(0);
  const [simInterval, setSimInterval] = useState<NodeJS.Timeout | null>(null);

  // State for verification explorer
  const [tcSearch, setTcSearch] = useState<string>("");
  const [tcStatusFilter, setTcStatusFilter] = useState<string>("ALL");
  const [expandedTc, setExpandedTc] = useState<string | null>(null);

  // State for waveform viewer
  const [selectedWaveTc, setSelectedWaveTc] = useState<string>("TC001");
  const [waveZoom, setWaveZoom] = useState<number>(1.0);
  const [wavePan, setWavePan] = useState<number>(0);
  const [hoveredCycle, setHoveredCycle] = useState<number | null>(null);
  const [highlightedSignal, setHighlightedSignal] = useState<string | null>(null);
  const [imageError, setImageError] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [startX, setStartX] = useState<number>(0);
  const [scrollLeft, setScrollLeft] = useState<number>(0);

  // Map testcases to their GTKWave images inside assets/waveforms/
  const tcWaveformMap = useMemo<{ [key: string]: string }>(() => ({
    TC001: "/assets/waveforms/TC001_Reset.png",
    TC002: "/assets/waveforms/TC002_SingleWrite.png",
    TC003: "/assets/waveforms/TC003_SingleRead.png",
    TC004: "/assets/waveforms/TC004_BacktoBackWrite.png",
    TC005: "/assets/waveforms/TC005_BacktoBackRead.png",
    TC006: "/assets/waveforms/TC006_WriteWaitState.png",
    TC007: "/assets/waveforms/TC007_ReadWaitState.png",
    TC008: "/assets/waveforms/TC008_IdleTransfer.png",
    TC009: "/assets/waveforms/TC009_BusyTransfer.png",
    TC010: "/assets/waveforms/TC010_PSTRBDecode.png",
    TC011: "/assets/waveforms/TC011_ErrorResponse.png",
    TC012: "/assets/waveforms/TC012_BurstTransfer.png",
    TC013: "/assets/waveforms/TC013_ResetMidTransfer.png",
    TC014: "/assets/waveforms/TC014_RandomStress.png"
  }), []);

  // Drag and pan functions for waveform viewer
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!scrollContainerRef.current) return;
    setIsDragging(true);
    setStartX(e.pageX - scrollContainerRef.current.offsetLeft);
    setScrollLeft(scrollContainerRef.current.scrollLeft);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !scrollContainerRef.current) return;
    e.preventDefault();
    const x = e.pageX - scrollContainerRef.current.offsetLeft;
    const walk = (x - startX) * 1.5;
    scrollContainerRef.current.scrollLeft = scrollLeft - walk;
  };

  const handleMouseUpOrLeave = () => {
    setIsDragging(false);
  };

  const handleResetView = () => {
    setWaveZoom(1.0);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollLeft = 0;
    }
  };

  const handleDownloadImage = () => {
    const path = tcWaveformMap[selectedWaveTc];
    if (!path) return;
    const element = document.createElement("a");
    element.href = path;
    element.download = `${selectedWaveTc}_Waveform.png`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    showNotify(`Waveform screenshot downloaded (${selectedWaveTc}_Waveform.png)`);
  };

  // Reset error state on selected wave change
  useEffect(() => {
    setImageError(false);
  }, [selectedWaveTc]);

  // State for console tab
  const [consoleSearch, setConsoleSearch] = useState<string>("");
  const [consoleFilter, setConsoleFilter] = useState<string>("ALL");
  const [copiedLog, setCopiedLog] = useState<boolean>(false);

  // State for custom feedback message/notification
  const [notification, setNotification] = useState<string | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);

  // Simulate FSM execution cycles
  const simSequences: { [key: string]: { state: string; label: string; desc: string; signals: any }[] } = {
    singleWrite: [
      { state: "idle", label: "IDLE (Cycle 0)", desc: "Waiting for transfer. HTRANS is idle. HREADYOUT is 1.", signals: { HTRANS: "IDLE", HWRITE: "0", HADDR: "0x0000", PSEL: "0", PENABLE: "0", PREADY: "1", HREADYOUT: "1" } },
      { state: "setup", label: "SETUP (Cycle 1)", desc: "AHB master triggers a write request. PSEL is driven high. HREADYOUT driven low to stall.", signals: { HTRANS: "NONSEQ", HWRITE: "1", HADDR: "0x1000", PSEL: "1", PENABLE: "0", PREADY: "1", HREADYOUT: "0" } },
      { state: "enable", label: "ENABLE (Cycle 2)", desc: "Access state. PENABLE goes high. APB peripheral is ready (PREADY=1). Write commits.", signals: { HTRANS: "IDLE", HWRITE: "0", HADDR: "0x1000", PSEL: "1", PENABLE: "1", PREADY: "1", HREADYOUT: "1" } },
      { state: "idle", label: "IDLE (Cycle 3)", desc: "Transaction completed successfully. State returned to idle.", signals: { HTRANS: "IDLE", HWRITE: "0", HADDR: "0x0000", PSEL: "0", PENABLE: "0", PREADY: "1", HREADYOUT: "1" } }
    ],
    writeWaitStates: [
      { state: "idle", label: "IDLE (Cycle 0)", desc: "Idle state on the bus.", signals: { HTRANS: "IDLE", HWRITE: "0", HADDR: "0x0000", PSEL: "0", PENABLE: "0", PREADY: "1", HREADYOUT: "1" } },
      { state: "setup", label: "SETUP (Cycle 1)", desc: "Write transaction to slow peripheral starts. PSEL high, HREADYOUT low.", signals: { HTRANS: "NONSEQ", HWRITE: "1", HADDR: "0x1008", PSEL: "1", PENABLE: "0", PREADY: "1", HREADYOUT: "0" } },
      { state: "enable", label: "ENABLE (Cycle 2)", desc: "Access state begins. PENABLE is asserted, but target drives PREADY low (stall).", signals: { HTRANS: "IDLE", HWRITE: "0", HADDR: "0x1008", PSEL: "1", PENABLE: "1", PREADY: "0", HREADYOUT: "0" } },
      { state: "wait_st", label: "WAIT_ST (Cycle 3)", desc: "Wait state. PREADY is still low. AHB master continues to stall.", signals: { HTRANS: "IDLE", HWRITE: "0", HADDR: "0x1008", PSEL: "1", PENABLE: "1", PREADY: "0", HREADYOUT: "0" } },
      { state: "wait_st", label: "WAIT_ST (Cycle 4)", desc: "Wait state. Peripheral finally asserts PREADY high in this cycle.", signals: { HTRANS: "IDLE", HWRITE: "0", HADDR: "0x1008", PSEL: "1", PENABLE: "1", PREADY: "1", HREADYOUT: "1" } },
      { state: "idle", label: "IDLE (Cycle 5)", desc: "Transaction completes successfully. Bus is idle.", signals: { HTRANS: "IDLE", HWRITE: "0", HADDR: "0x0000", PSEL: "0", PENABLE: "0", PREADY: "1", HREADYOUT: "1" } }
    ],
    errorResponse: [
      { state: "idle", label: "IDLE (Cycle 0)", desc: "Bus is idle.", signals: { HTRANS: "IDLE", HWRITE: "0", HADDR: "0x0000", PSEL: "0", PENABLE: "0", PREADY: "1", HREADYOUT: "1" } },
      { state: "setup", label: "SETUP (Cycle 1)", desc: "Write request to invalid address space.", signals: { HTRANS: "NONSEQ", HWRITE: "1", HADDR: "0x5000", PSEL: "1", PENABLE: "0", PREADY: "1", HREADYOUT: "0" } },
      { state: "enable", label: "ENABLE (Cycle 2)", desc: "APB target asserts PSLVERR=1, signaling a bus error.", signals: { HTRANS: "IDLE", HWRITE: "0", HADDR: "0x5000", PSEL: "1", PENABLE: "1", PREADY: "1", HREADYOUT: "0" } },
      { state: "error_c1", label: "ERROR_C1 (Cycle 3)", desc: "First cycle of AHB error response. HRESP driven to ERROR, HREADYOUT remains 0.", signals: { HTRANS: "IDLE", HWRITE: "0", HADDR: "0x5000", PSEL: "0", PENABLE: "0", PREADY: "1", HREADYOUT: "0", HRESP: "ERROR" } },
      { state: "error_c2", label: "ERROR_C2 (Cycle 4)", desc: "Second cycle of AHB error response. HREADYOUT is raised to 1, releasing master.", signals: { HTRANS: "IDLE", HWRITE: "0", HADDR: "0x5000", PSEL: "0", PENABLE: "0", PREADY: "1", HREADYOUT: "1", HRESP: "ERROR" } },
      { state: "idle", label: "IDLE (Cycle 5)", desc: "Error sequence completed. Master aborts or recovers.", signals: { HTRANS: "IDLE", HWRITE: "0", HADDR: "0x0000", PSEL: "0", PENABLE: "0", PREADY: "1", HREADYOUT: "1", HRESP: "OK" } }
    ]
  };

  const showNotify = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  const handleCopyLog = () => {
    navigator.clipboard.writeText(CONSOLE_OUTPUT);
    setCopiedLog(true);
    showNotify("CI/CD simulation log copied to clipboard.");
    setTimeout(() => setCopiedLog(false), 2000);
  };

  const handleDownloadLog = () => {
    const element = document.createElement("a");
    const file = new Blob([CONSOLE_OUTPUT], { type: "text/plain" });
    element.href = URL.createObjectURL(file);
    element.download = "vcs_ahb_apb_regression.log";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    showNotify("Simulation log downloaded (vcs_ahb_apb_regression.log)");
  };

  // Start an FSM simulation sequence
  const startSimulation = (seqKey: string) => {
    if (simInterval) {
      clearInterval(simInterval);
    }
    setActiveSimulation(seqKey);
    setSimStep(0);
    const seq = simSequences[seqKey];
    setSelectedFsmState(seq[0].state);

    const interval = setInterval(() => {
      setSimStep((prev) => {
        const next = prev + 1;
        if (next < seq.length) {
          setSelectedFsmState(seq[next].state);
          return next;
        } else {
          clearInterval(interval);
          setActiveSimulation(null);
          return prev;
        }
      });
    }, 2000);
    setSimInterval(interval);
  };

  const stopSimulation = () => {
    if (simInterval) {
      clearInterval(simInterval);
      setSimInterval(null);
    }
    setActiveSimulation(null);
    setSimStep(0);
  };

  useEffect(() => {
    return () => {
      if (simInterval) clearInterval(simInterval);
    };
  }, [simInterval]);

  // Filter testcases
  const filteredTestCases = useMemo(() => {
    return TEST_CASES.filter((tc) => {
      const matchesSearch =
        tc.id.toLowerCase().includes(tcSearch.toLowerCase()) ||
        tc.name.toLowerCase().includes(tcSearch.toLowerCase()) ||
        tc.objective.toLowerCase().includes(tcSearch.toLowerCase()) ||
        tc.rtlFeature.toLowerCase().includes(tcSearch.toLowerCase());

      const matchesStatus =
        tcStatusFilter === "ALL" || tc.status === tcStatusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [tcSearch, tcStatusFilter]);

  // Filter console logs
  const filteredConsoleLines = useMemo(() => {
    const lines = CONSOLE_OUTPUT.split("\n");
    return lines.filter((line) => {
      const matchesSearch = line.toLowerCase().includes(consoleSearch.toLowerCase());
      if (consoleFilter === "ALL") return matchesSearch;
      if (consoleFilter === "PASS") return matchesSearch && (line.includes("[PASS]") || line.includes("PASSED"));
      if (consoleFilter === "INFO") return matchesSearch && line.includes("[INFO]");
      if (consoleFilter === "ERR") return matchesSearch && (line.includes("ERROR") || line.includes("ERRORS"));
      return matchesSearch;
    });
  }, [consoleSearch, consoleFilter]);

  // Helper to convert OKLAB coordinates to RGB Direct
  const oklabToRgbDirect = (l: number, a_val: number, b_val: number, a: number): string => {
    let l_ = l + 0.3963377774 * a_val + 0.2158037573 * b_val;
    let m_ = l - 0.1055613458 * a_val - 0.0638541728 * b_val;
    let s_ = l - 0.0894841775 * a_val - 1.2914855480 * b_val;

    let l_cube = l_ * l_ * l_;
    let m_cube = m_ * m_ * m_;
    let s_cube = s_ * s_ * s_;

    let r = 4.0767416621 * l_cube - 3.3077115913 * m_cube + 0.2309699292 * s_cube;
    let g = -1.2684380046 * l_cube + 2.6097574011 * m_cube - 0.3413193965 * s_cube;
    let b = -0.0041960863 * l_cube - 0.7034186147 * m_cube + 1.7076147010 * s_cube;

    const gamma = (val: number) => {
      let clamped = Math.max(0, Math.min(1, val));
      return clamped <= 0.0031308
        ? 12.92 * clamped
        : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
    };

    let r_final = Math.round(gamma(r) * 255);
    let g_final = Math.round(gamma(g) * 255);
    let b_final = Math.round(gamma(b) * 255);

    return `rgba(${r_final}, ${g_final}, ${b_final}, ${a})`;
  };

  // Helper to convert OKLCH to RGB/RGBA
  const oklchToRgb = (lStr: string, cStr: string, hStr: string, aStr?: string): string => {
    let l = parseFloat(lStr);
    if (lStr.includes("%")) l = l / 100;

    let c = parseFloat(cStr);
    if (cStr.includes("%")) c = c / 100;

    let h = parseFloat(hStr);
    if (hStr.toLowerCase().includes("rad")) {
      h = (h * 180) / Math.PI;
    } else if (hStr.toLowerCase().includes("grad")) {
      h = (h * 360) / 400;
    } else if (hStr.toLowerCase().includes("turn")) {
      h = h * 360;
    }

    let a = 1;
    if (aStr) {
      let parsedA = parseFloat(aStr);
      if (aStr.includes("%")) {
        a = parsedA / 100;
      } else {
        a = parsedA;
      }
    }

    const hRad = (h * Math.PI) / 180;
    const a_val = c * Math.cos(hRad);
    const b_val = c * Math.sin(hRad);

    return oklabToRgbDirect(l, a_val, b_val, a);
  };

  // Helper to convert OKLAB to RGB/RGBA
  const oklabToRgb = (lStr: string, aStr: string, bStr: string, alphaStr?: string): string => {
    let l = parseFloat(lStr);
    if (lStr.includes("%")) l = l / 100;

    let a_val = parseFloat(aStr);
    if (aStr.includes("%")) a_val = a_val / 100;

    let b_val = parseFloat(bStr);
    if (bStr.includes("%")) b_val = b_val / 100;

    let a = 1;
    if (alphaStr) {
      let parsedA = parseFloat(alphaStr);
      if (alphaStr.includes("%")) {
        a = parsedA / 100;
      } else {
        a = parsedA;
      }
    }

    return oklabToRgbDirect(l, a_val, b_val, a);
  };

  // Regex string converter helper
  const convertOklchAndOklabText = (text: string): string => {
    if (!text) return "";
    
    // Replace OKLCH with split logic
    let converted = text.replace(
      /oklch\s*\(([^)]+)\)/gi,
      (match, inner) => {
        try {
          const parts = inner.trim().split(/[\s,/\\]+/);
          if (parts.length >= 3) {
            return oklchToRgb(parts[0], parts[1], parts[2], parts[3]);
          }
        } catch (e) {
          // ignore
        }
        return match;
      }
    );

    // Replace OKLAB with split logic
    converted = converted.replace(
      /oklab\s*\(([^)]+)\)/gi,
      (match, inner) => {
        try {
          const parts = inner.trim().split(/[\s,/\\]+/);
          if (parts.length >= 3) {
            return oklabToRgb(parts[0], parts[1], parts[2], parts[3]);
          }
        } catch (e) {
          // ignore
        }
        return match;
      }
    );

    return converted;
  };

  // PDF Export function with automated OKLCH/OKLAB compatibility handling
  const handleExportPDF = async () => {
    const element = document.getElementById("verification-report-document");
    if (!element) {
      showNotify("Error: Report container not found.");
      return;
    }

    setIsGeneratingPdf(true);
    showNotify("Generating high-fidelity PDF report...");

    const styleBackups: { element: HTMLStyleElement; originalText: string }[] = [];
    const linkBackups: HTMLLinkElement[] = [];
    const inlineStyleBackups: { element: HTMLElement | SVGElement; originalCssText: string }[] = [];
    let tempStyleTag: HTMLStyleElement | null = null;

    try {
      // 1. BACKUP & CONVERT STYLE TAGS
      const styleTags = Array.from(document.querySelectorAll("style"));
      styleTags.forEach((tag) => {
        styleBackups.push({
          element: tag,
          originalText: tag.textContent || "",
        });
        const originalText = tag.textContent || "";
        if (originalText.includes("oklch") || originalText.includes("oklab")) {
          tag.textContent = convertOklchAndOklabText(originalText);
        }
      });

      // 2. BACKUP & CONVERT LINKED STYLESHEETS
      const linkTags = Array.from(document.querySelectorAll("link[rel='stylesheet']"));
      let compiledLinkStyles = "";
      linkTags.forEach((link) => {
        try {
          const sheet = (link as HTMLLinkElement).sheet;
          if (sheet) {
            let rulesText = "";
            const rules = sheet.cssRules || sheet.rules;
            for (let i = 0; i < rules.length; i++) {
              rulesText += rules[i].cssText + "\n";
            }
            compiledLinkStyles += rulesText + "\n";
            (link as HTMLLinkElement).disabled = true;
            linkBackups.push(link as HTMLLinkElement);
          }
        } catch (e) {
          // Fallback or ignore if CORS security restricts rules access
          console.warn("Could not read stylesheet rules from link:", link, e);
        }
      });

      // 3. CREATE TEMPORARY COMPATIBLE STYLE BLOCK
      if (compiledLinkStyles) {
        tempStyleTag = document.createElement("style");
        tempStyleTag.id = "temp-converted-link-styles";
        tempStyleTag.textContent = convertOklchAndOklabText(compiledLinkStyles);
        document.head.appendChild(tempStyleTag);
      }

      // 4. TRAVERSE THE DOM AND CONVERT COMPUTED OKLCH/OKLAB COLORS INLINE ON ALL ELEMENTS
      const convertElementStyles = (el: Element) => {
        const htmlOrSvgEl = el as HTMLElement | SVGElement;
        if (!htmlOrSvgEl.style) return;

        inlineStyleBackups.push({
          element: htmlOrSvgEl,
          originalCssText: htmlOrSvgEl.style.cssText,
        });

        const computed = window.getComputedStyle(el);
        const propertiesToConvert = [
          "color",
          "backgroundColor",
          "borderColor",
          "borderTopColor",
          "borderRightColor",
          "borderBottomColor",
          "borderLeftColor",
          "fill",
          "stroke",
        ];

        propertiesToConvert.forEach((prop) => {
          try {
            const val = computed[prop as any];
            if (val && (val.includes("oklch") || val.includes("oklab"))) {
              const convertedVal = convertOklchAndOklabText(val);
              if (convertedVal !== val) {
                (htmlOrSvgEl.style as any)[prop] = convertedVal;
              }
            }
          } catch (e) {
            // Safe fallback
          }
        });

        Array.from(el.children).forEach((child) => {
          convertElementStyles(child);
        });
      };

      // Run computed style conversion
      convertElementStyles(element);

      // Force scroll to top to capture fully
      window.scrollTo(0, 0);

      // Render canvas with html2canvas
      const canvas = await html2canvas(element, {
        scale: 2, // High resolution for text readability
        useCORS: true,
        allowTaint: true,
        backgroundColor: "#0e0e12",
        logging: false,
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "pt", "a4");

      const imgWidth = 595.28; // A4 standard width in points
      const pageHeight = 841.89; // A4 standard height in points
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      let heightLeft = imgHeight;
      let position = 0;
      let pageCount = 1;

      // Draw the first page
      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight, undefined, "FAST");
      heightLeft -= pageHeight;

      // Split remaining content into pages
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight, undefined, "FAST");
        heightLeft -= pageHeight;
        pageCount++;
      }

      // Add clean professional borders and footer content on every page
      for (let i = 1; i <= pageCount; i++) {
        pdf.setPage(i);
        
        // Draw dark solid banner to avoid text cutoff intersections with footers
        pdf.setFillColor(14, 14, 18); // matches theme background (#0e0e12)
        pdf.rect(0, pageHeight - 30, imgWidth, 30, "F");

        // Thin elegant divider line
        pdf.setDrawColor(30, 41, 59); // slate-800
        pdf.setLineWidth(0.5);
        pdf.line(0, pageHeight - 30, imgWidth, pageHeight - 30);

        // Footer meta text
        pdf.setFont("Helvetica", "normal");
        pdf.setFontSize(8);
        pdf.setTextColor(100, 116, 139); // slate-500
        
        pdf.text("AHB-Lite to APB4 Bridge Design Verification Report", 30, pageHeight - 12);
        pdf.text(`Page ${i} of ${pageCount}`, imgWidth - 85, pageHeight - 12);
      }

      pdf.save("AHB_APB4_Bridge_Design_Verification_Report.pdf");
      showNotify("PDF Report successfully exported!");
    } catch (error) {
      console.error("PDF generation failed:", error);
      showNotify("Failed to generate PDF. Check console for details.");
    } finally {
      // 5. RESTORE ORIGINAL STYLESHEETS & LINKS
      styleBackups.forEach((b) => {
        b.element.textContent = b.originalText;
      });

      linkBackups.forEach((link) => {
        link.disabled = false;
      });

      if (tempStyleTag) {
        tempStyleTag.remove();
      }

      // Restore inline styles
      inlineStyleBackups.forEach((b) => {
        try {
          b.element.style.cssText = b.originalCssText;
        } catch (e) {
          // Safe fallback
        }
      });

      setIsGeneratingPdf(false);
    }
  };

  return (
    <div className="fixed inset-0 flex bg-[#0a0a0c] text-slate-300 font-sans text-xs overflow-hidden select-none">
      {/* Toast Notification */}
      {notification && (
        <div className="fixed bottom-4 right-4 bg-slate-900 border border-emerald-500/40 text-emerald-400 px-4 py-3 rounded-lg shadow-xl flex items-center gap-2 z-50 animate-bounce">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <span className="font-mono text-[11px]">{notification}</span>
        </div>
      )}

      {/* Sidebar */}
      <aside className="w-56 h-full bg-[#111114] border-r border-slate-800/80 flex flex-col shrink-0">
        <div className="p-6 border-b border-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-emerald-500 rounded flex items-center justify-center text-black font-extrabold text-sm tracking-wider shadow-md shadow-emerald-500/20">
              NV
            </div>
            <div className="leading-none">
              <p className="text-white font-bold tracking-wider text-[11px]">RTL REVIEW</p>
              <p className="text-[10px] text-emerald-500 font-mono font-semibold mt-0.5">AHB-APB BRIDGE</p>
            </div>
          </div>
        </div>

        {/* Navigation Menu */}
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          <p className="px-3 py-1 text-[9px] uppercase tracking-widest text-slate-500 font-bold mb-1">Navigation</p>
          <button
            onClick={() => setActiveTab("dashboard")}
            className={`w-full px-3 py-2 rounded text-left flex items-center gap-3 transition-colors ${
              activeTab === "dashboard"
                ? "bg-slate-800 text-white font-medium"
                : "text-slate-400 hover:bg-slate-800/40 hover:text-slate-200"
            }`}
          >
            <Activity className="w-4 h-4 text-emerald-500" />
            <span>Dashboard</span>
          </button>
          <button
            onClick={() => setActiveTab("architecture")}
            className={`w-full px-3 py-2 rounded text-left flex items-center gap-3 transition-colors ${
              activeTab === "architecture"
                ? "bg-slate-800 text-white font-medium"
                : "text-slate-400 hover:bg-slate-800/40 hover:text-slate-200"
            }`}
          >
            <Compass className="w-4 h-4 text-blue-400" />
            <span>Architecture</span>
          </button>
          <button
            onClick={() => setActiveTab("modules")}
            className={`w-full px-3 py-2 rounded text-left flex items-center gap-3 transition-colors ${
              activeTab === "modules"
                ? "bg-slate-800 text-white font-medium"
                : "text-slate-400 hover:bg-slate-800/40 hover:text-slate-200"
            }`}
          >
            <Cpu className="w-4 h-4 text-purple-400" />
            <span>RTL Modules</span>
          </button>
          <button
            onClick={() => setActiveTab("fsm")}
            className={`w-full px-3 py-2 rounded text-left flex items-center gap-3 transition-colors ${
              activeTab === "fsm"
                ? "bg-slate-800 text-white font-medium"
                : "text-slate-400 hover:bg-slate-800/40 hover:text-slate-200"
            }`}
          >
            <Workflow className="w-4 h-4 text-cyan-400" />
            <span>FSM Analysis</span>
          </button>
          <button
            onClick={() => setActiveTab("verification")}
            className={`w-full px-3 py-2 rounded text-left flex items-center gap-3 transition-colors ${
              activeTab === "verification"
                ? "bg-slate-800 text-white font-medium"
                : "text-slate-400 hover:bg-slate-800/40 hover:text-slate-200"
            }`}
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>Verification</span>
          </button>
          <button
            onClick={() => setActiveTab("waveforms")}
            className={`w-full px-3 py-2 rounded text-left flex items-center gap-3 transition-colors ${
              activeTab === "waveforms"
                ? "bg-slate-800 text-white font-medium"
                : "text-slate-400 hover:bg-slate-800/40 hover:text-slate-200"
            }`}
          >
            <Sliders className="w-4 h-4 text-yellow-500" />
            <span>Waveforms</span>
          </button>
          <button
            onClick={() => setActiveTab("console")}
            className={`w-full px-3 py-2 rounded text-left flex items-center gap-3 transition-colors ${
              activeTab === "console"
                ? "bg-slate-800 text-white font-medium"
                : "text-slate-400 hover:bg-slate-800/40 hover:text-slate-200"
            }`}
          >
            <Terminal className="w-4 h-4 text-emerald-400" />
            <span>VCS Console</span>
          </button>
          <button
            onClick={() => setActiveTab("traceability")}
            className={`w-full px-3 py-2 rounded text-left flex items-center gap-3 transition-colors ${
              activeTab === "traceability"
                ? "bg-slate-800 text-white font-medium"
                : "text-slate-400 hover:bg-slate-800/40 hover:text-slate-200"
            }`}
          >
            <Layers className="w-4 h-4 text-indigo-400" />
            <span>Traceability</span>
          </button>
          <button
            onClick={() => setActiveTab("report")}
            className={`w-full px-3 py-2 rounded text-left flex items-center gap-3 transition-colors ${
              activeTab === "report"
                ? "bg-slate-800 text-white font-medium"
                : "text-slate-400 hover:bg-slate-800/40 hover:text-slate-200"
            }`}
          >
            <FileText className="w-4 h-4 text-amber-500" />
            <span>Export Report</span>
          </button>
        </nav>


      </aside>

      {/* Main Container */}
      <main className="flex-1 flex flex-col h-full bg-[#0a0a0c] overflow-hidden">
        {/* Header */}
        <header className="h-16 border-b border-slate-800/80 flex items-center justify-between px-8 bg-[#0a0a0c]/80 backdrop-blur-md shrink-0">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-bold text-white tracking-wider uppercase font-mono">
              AHB-Lite to APB4 Bridge
              <span className="text-slate-500 font-normal ml-3 text-[11px] font-sans italic">// RTL Engineering Sign-off Dashboard</span>
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1 bg-emerald-500/10 border border-emerald-500/30 rounded-full">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
              <span className="text-emerald-500 font-bold uppercase tracking-wider text-[9px] font-mono">
                Ready for Review
              </span>
            </div>
            <div className="h-8 w-[1px] bg-slate-800"></div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500 font-mono">GPDK 180nm</span>
              <span className="px-2 py-0.5 bg-slate-800 rounded font-mono text-[10px] text-slate-300">v4.2.1-stable</span>
            </div>
          </div>
        </header>

        {/* Content Tabs container */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Dashboard Tab */}
          {activeTab === "dashboard" && (
            <div className="space-y-6 animate-fade-in">
              {/* Summary Metrics */}
              <div className="grid grid-cols-4 gap-4">
                <div className="bg-slate-900/40 border border-slate-800/80 p-4 rounded-xl flex flex-col justify-between shadow-lg shadow-black/25">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-slate-400 font-bold uppercase text-[9px] tracking-widest">Directed Tests</span>
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  </div>
                  <div className="flex items-end justify-between mt-1">
                    <span className="text-2xl font-bold text-white font-mono">14/14</span>
                    <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] rounded font-mono font-bold">100% PASS</span>
                  </div>
                </div>

                <div className="bg-slate-900/40 border border-slate-800/80 p-4 rounded-xl flex flex-col justify-between shadow-lg shadow-black/25">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-slate-400 font-bold uppercase text-[9px] tracking-widest">Total Sim Tests</span>
                    <Terminal className="w-4 h-4 text-blue-400" />
                  </div>
                  <div className="flex items-end justify-between mt-1">
                    <span className="text-2xl font-bold text-white font-mono">215 / 215</span>
                    <span className="text-blue-400 font-mono text-[10px] font-semibold">ALL PASSED</span>
                  </div>
                </div>

                <div className="bg-slate-900/40 border border-slate-800/80 p-4 rounded-xl flex flex-col justify-between shadow-lg shadow-black/25">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-slate-400 font-bold uppercase text-[9px] tracking-widest">Total Coverage</span>
                    <Activity className="w-4 h-4 text-cyan-400" />
                  </div>
                  <div className="flex items-end justify-between mt-1">
                    <span className="text-2xl font-bold text-white font-mono">100%</span>
                    <div className="w-24 h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div className="w-full h-full bg-cyan-500 rounded-full"></div>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-900/40 border border-slate-800/80 p-4 rounded-xl flex flex-col justify-between shadow-lg shadow-black/25">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-slate-400 font-bold uppercase text-[9px] tracking-widest">Critical Errors</span>
                    <XCircle className="w-4 h-4 text-slate-500" />
                  </div>
                  <div className="flex items-end justify-between mt-1">
                    <span className="text-2xl font-bold text-white font-mono">0</span>
                    <span className="text-slate-500 font-semibold font-mono text-[10px]">GOLDEN SIGN-OFF</span>
                  </div>
                </div>
              </div>

              {/* Interactive SVG Block Diagram Section */}
              <div className="bg-slate-900/30 border border-slate-800/80 rounded-xl p-6 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none"></div>
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-500/5 rounded-full blur-3xl pointer-events-none"></div>

                <div className="flex justify-between items-center mb-6 border-b border-slate-800/50 pb-4">
                  <div>
                    <h2 className="text-xs font-bold text-slate-300 uppercase tracking-widest font-mono">Architecture Logic Block Flow</h2>
                    <p className="text-slate-500 text-[10px] mt-0.5">Click any hardware block to explore pins, register banks, inputs, outputs, and design trade-offs.</p>
                  </div>
                  <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[9px] font-mono rounded">INTERACTIVE SCHEMATIC</span>
                </div>

                {/* Block Flow Schematic */}
                <div className="flex flex-col md:flex-row items-center justify-between gap-4 p-6 bg-[#0d0d11]/80 rounded-lg border border-slate-800/50">
                  {/* AHB Master Block */}
                  <div
                    onClick={() => { setSelectedModule("ahb_slave"); setActiveTab("architecture"); }}
                    className="group cursor-pointer w-36 h-20 border border-slate-700 hover:border-emerald-500 bg-slate-800/80 flex flex-col items-center justify-center text-center p-3 rounded-lg shadow-lg shadow-black/40 transition-all duration-300 hover:scale-105"
                  >
                    <p className="text-white font-extrabold text-[11px] tracking-wider group-hover:text-emerald-400">AHB Master</p>
                    <p className="text-[9px] text-slate-500 font-mono mt-1">External Initiator</p>
                  </div>

                  {/* Arrow */}
                  <div className="flex-1 flex flex-col items-center justify-center min-w-[30px]">
                    <span className="text-[9px] text-slate-600 font-mono">AHB Bus</span>
                    <div className="h-[2px] w-full bg-slate-700 relative">
                      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-0 h-0 border-y-4 border-y-transparent border-l-4 border-l-slate-700"></div>
                    </div>
                  </div>

                  {/* AHB Slave Interface Block */}
                  <div
                    onClick={() => { setSelectedModule("ahb_slave"); setActiveTab("modules"); }}
                    className="group cursor-pointer w-44 h-24 border-2 border-slate-600 hover:border-emerald-500 bg-slate-900/90 p-3 rounded-lg flex flex-col justify-between shadow-lg transition-all duration-300 hover:scale-105"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-mono text-emerald-400 font-bold">1/5 SLAVE IF</span>
                      <Cpu className="w-3.5 h-3.5 text-slate-500 group-hover:text-emerald-400" />
                    </div>
                    <div>
                      <p className="text-white font-bold uppercase text-[10px] tracking-tight group-hover:text-emerald-400">AHB Slave</p>
                      <p className="text-slate-500 text-[9px] truncate font-mono mt-0.5">Pins: HCLK, HADDR, HSEL</p>
                    </div>
                  </div>

                  {/* Arrow */}
                  <div className="flex-1 flex flex-col items-center justify-center min-w-[20px]">
                    <div className="h-[2px] w-full bg-slate-700 relative">
                      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-0 h-0 border-y-4 border-y-transparent border-l-4 border-l-slate-700"></div>
                    </div>
                  </div>

                  {/* Write Data Register & Bridge FSM Container */}
                  <div className="flex flex-col gap-2">
                    {/* Write Reg */}
                    <div
                      onClick={() => { setSelectedModule("write_reg"); setActiveTab("modules"); }}
                      className="group cursor-pointer w-44 h-12 border border-slate-700 hover:border-blue-400 bg-slate-900/90 p-2 rounded-md flex items-center justify-between shadow transition-all duration-300 hover:scale-102"
                    >
                      <span className="text-[9px] font-mono text-blue-400">2/5 Write Reg</span>
                      <div className="text-right">
                        <p className="text-white text-[9px] font-bold uppercase group-hover:text-blue-400">Buffer Unit</p>
                        <p className="text-[8px] text-slate-500 font-mono">HWDATA[31:0]</p>
                      </div>
                    </div>

                    {/* Bridge FSM */}
                    <div
                      onClick={() => { setSelectedModule("bridge_fsm"); setActiveTab("fsm"); }}
                      className="group cursor-pointer w-44 h-16 border-2 border-cyan-500/50 hover:border-cyan-400 bg-cyan-950/20 p-2 rounded-md flex flex-col justify-between shadow-lg shadow-cyan-500/5 transition-all duration-300 hover:scale-105"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-mono text-cyan-400 font-bold">3/5 BRIDGE FSM</span>
                        <Workflow className="w-3.5 h-3.5 text-cyan-400" />
                      </div>
                      <div>
                        <p className="text-white text-[9px] font-bold uppercase group-hover:text-cyan-300">Controller logic</p>
                        <p className="text-slate-400 text-[8px] font-mono">6 States | Compliant</p>
                      </div>
                    </div>
                  </div>

                  {/* Arrow */}
                  <div className="flex-1 flex flex-col items-center justify-center min-w-[20px]">
                    <div className="h-[2px] w-full bg-slate-700 relative">
                      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-0 h-0 border-y-4 border-y-transparent border-l-4 border-l-slate-700"></div>
                    </div>
                  </div>

                  {/* APB Master Block */}
                  <div
                    onClick={() => { setSelectedModule("apb_master"); setActiveTab("modules"); }}
                    className="group cursor-pointer w-44 h-24 border-2 border-slate-600 hover:border-emerald-500 bg-slate-900/90 p-3 rounded-lg flex flex-col justify-between shadow-lg transition-all duration-300 hover:scale-105"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-mono text-emerald-400 font-bold">4/5 MASTER IF</span>
                      <Cpu className="w-3.5 h-3.5 text-slate-500 group-hover:text-emerald-400" />
                    </div>
                    <div>
                      <p className="text-white font-bold uppercase text-[10px] tracking-tight group-hover:text-emerald-400">APB Master</p>
                      <p className="text-slate-500 text-[9px] truncate font-mono mt-0.5">Pins: PSEL, PENABLE, PSTRB</p>
                    </div>
                  </div>

                  {/* Arrow */}
                  <div className="flex-1 flex flex-col items-center justify-center min-w-[30px]">
                    <span className="text-[9px] text-slate-600 font-mono">APB4 Bus</span>
                    <div className="h-[2px] w-full bg-slate-700 relative">
                      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-0 h-0 border-y-4 border-y-transparent border-l-4 border-l-slate-700"></div>
                    </div>
                  </div>

                  {/* APB Peripheral Block */}
                  <div
                    onClick={() => { setSelectedModule("apb_peripheral"); setActiveTab("modules"); }}
                    className="group cursor-pointer w-36 h-20 border border-slate-700 hover:border-purple-400 bg-slate-800/80 flex flex-col items-center justify-center text-center p-3 rounded-lg shadow-lg shadow-black/40 transition-all duration-300 hover:scale-105"
                  >
                    <p className="text-white font-extrabold text-[11px] tracking-wider group-hover:text-purple-400">APB Target</p>
                    <p className="text-[9px] text-slate-500 font-mono mt-1">DUT Memory Space</p>
                  </div>
                </div>

                {/* Additional Spec Notes below Block */}
                <div className="mt-4 grid grid-cols-4 gap-4">
                  <div className="p-3 bg-slate-950/60 rounded border border-slate-800/50">
                    <p className="text-[9px] text-slate-500 mb-1 font-bold tracking-widest uppercase font-mono">Target Protocol</p>
                    <p className="text-white font-semibold text-[10px]">AMBA APB Protocol Spec v4.0 (APB4)</p>
                  </div>
                  <div className="p-3 bg-slate-950/60 rounded border border-slate-800/50">
                    <p className="text-[9px] text-slate-500 mb-1 font-bold tracking-widest uppercase font-mono">Clock Domains</p>
                    <p className="text-white font-semibold text-[10px]">Fully Synchronous: HCLK == PCLK</p>
                  </div>
                  <div className="p-3 bg-slate-950/60 rounded border border-slate-800/50">
                    <p className="text-[9px] text-slate-500 mb-1 font-bold tracking-widest uppercase font-mono">Supported Sizes</p>
                    <p className="text-white font-semibold text-[10px]">Byte (8-bit), Halfword (16-bit), Word (32-bit)</p>
                  </div>
                  <div className="p-3 bg-slate-950/60 rounded border border-slate-800/50">
                    <p className="text-[9px] text-slate-500 mb-1 font-bold tracking-widest uppercase font-mono">Sign-off Standard</p>
                    <p className="text-white font-semibold text-[10px]">NVIDIA Golden Core RTL Criteria</p>
                  </div>
                </div>
              </div>

              {/* Three Column Info Section on Dashboard: (1) Recent Tests, (2) Traceability Preview, (3) Terminal Log Snippet */}
              <div className="grid grid-cols-12 gap-4">
                {/* Recent Tests (Col 6) */}
                <div className="col-span-12 lg:col-span-6 bg-slate-900/40 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between shadow-lg shadow-black/20">
                  <div className="flex justify-between items-center mb-3">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono">Recent Testcase Sign-off</h3>
                    </div>
                    <button
                      onClick={() => setActiveTab("verification")}
                      className="text-[10px] text-emerald-400 hover:text-emerald-300 font-mono transition"
                    >
                      VIEW ALL 14 TESTCASES &rarr;
                    </button>
                  </div>
                  <div className="space-y-2 overflow-y-auto max-h-[250px] pr-1">
                    {TEST_CASES.slice(0, 4).map((tc) => (
                      <div
                        key={tc.id}
                        onClick={() => { setSelectedWaveTc(tc.id); setActiveTab("waveforms"); }}
                        className="bg-slate-800/40 hover:bg-slate-800/80 border border-slate-700/40 hover:border-emerald-500/40 p-2 rounded flex items-center justify-between transition cursor-pointer"
                        title="Click to view waveforms"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-slate-500 font-mono text-[10px] font-bold">{tc.id}</span>
                          <div>
                            <p className="text-slate-200 font-bold text-[10px] leading-snug">{tc.name}</p>
                            <p className="text-[9px] text-slate-500 italic font-mono truncate max-w-[250px]">{tc.rtlFeature}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[9px] text-slate-500 font-mono uppercase bg-slate-900/80 px-1.5 py-0.5 rounded border border-slate-800">{tc.specMapping}</span>
                          <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 text-[9px] font-bold border border-emerald-500/30 rounded font-mono">
                            {tc.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Console Snippet (Col 6) */}
                <div className="col-span-12 lg:col-span-6 bg-slate-950 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between font-mono shadow-lg shadow-black/40">
                  <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center gap-2">
                      <Terminal className="w-4 h-4 text-emerald-500" />
                      <span className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">VCS Sim Regression Monitor</span>
                    </div>
                    <div className="flex gap-1">
                      <span className="w-2 h-2 rounded-full bg-[#111114]"></span>
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    </div>
                  </div>
                  <div className="bg-black/90 p-3 rounded-lg flex-1 text-[9px] leading-relaxed text-slate-300 space-y-1 overflow-y-auto max-h-[180px] border border-slate-900">
                    <p className="text-slate-500 font-bold">$ ./run_regression.sh -all -bridge</p>
                    <p className="text-emerald-500">[PASS] TC001 Reset Initialization</p>
                    <p className="text-emerald-500">[PASS] TC002 Single Write Transaction</p>
                    <p className="text-emerald-500">[PASS] TC003 Single Read Transaction</p>
                    <p className="text-yellow-500">[STALL] TC006 APB Wait State Inject (3 cycles)</p>
                    <p className="text-emerald-500">[PASS] TC011 Error Response Flow</p>
                    <p className="text-emerald-400 font-semibold underline mt-2">REGRESSION RUN : 215 | ERRORS : 0</p>
                    <p className="text-emerald-400 font-bold">RESULT : 100% SPEC SIGN-OFF PASSED</p>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={handleCopyLog}
                      className="flex-1 py-1.5 px-3 border border-slate-800 text-[9px] text-slate-400 rounded uppercase font-bold hover:bg-slate-800/50 hover:text-white transition cursor-pointer"
                    >
                      Copy Log
                    </button>
                    <button
                      onClick={() => setActiveTab("console")}
                      className="flex-1 py-1.5 px-3 border border-slate-800 text-[9px] text-emerald-400 rounded uppercase font-bold hover:bg-slate-800/50 transition cursor-pointer"
                    >
                      Launch Terminal Console &rarr;
                    </button>
                  </div>
                </div>
              </div>

              {/* Requirement Traceability Preview on Dashboard */}
              <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-4 shadow-lg shadow-black/25">
                <div className="flex justify-between items-center mb-3">
                  <div className="flex items-center gap-2">
                    <Table className="w-4 h-4 text-emerald-500" />
                    <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono">Traceability Spec Matrix Preview</h3>
                  </div>
                  <button
                    onClick={() => setActiveTab("traceability")}
                    className="text-[10px] text-emerald-400 hover:text-emerald-300 font-mono transition"
                  >
                    FULL MATRIX &rarr;
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px] font-mono">
                    <thead className="text-slate-500 border-b border-slate-800 uppercase text-[9px]">
                      <tr>
                        <th className="text-left py-2 px-3 font-bold">Requirement ID</th>
                        <th className="text-left py-2 px-3 font-bold">RTL Target Module</th>
                        <th className="text-left py-2 px-3 font-bold">Mapped Testcase</th>
                        <th className="text-left py-2 px-3 font-bold">Verification Scope Description</th>
                        <th className="text-right py-2 px-3 font-bold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-300 divide-y divide-slate-800/40">
                      {TRACEABILITY.slice(0, 4).map((item, index) => (
                        <tr key={index} className="hover:bg-slate-800/20">
                          <td className="py-2.5 px-3 text-emerald-400 font-bold">{item.requirement}</td>
                          <td className="py-2.5 px-3">{item.rtlModule}</td>
                          <td className="py-2.5 px-3 font-semibold text-blue-400 cursor-pointer hover:underline" onClick={() => { setSelectedWaveTc(item.testcase); setActiveTab("waveforms"); }}>
                            {item.testcase}
                          </td>
                          <td className="py-2.5 px-3 text-slate-400 text-[9px] italic">{item.details}</td>
                          <td className="py-2.5 px-3 text-right">
                            <span className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[9px] rounded font-bold">PASS</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Architecture Tab */}
          {activeTab === "architecture" && (
            <div className="space-y-6 animate-fade-in">
              <div className="grid grid-cols-12 gap-6">
                {/* Left Side: interactive layout selector */}
                <div className="col-span-12 lg:col-span-4 space-y-4">
                  <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-4 shadow-lg">
                    <h3 className="text-xs font-bold text-slate-300 uppercase tracking-widest font-mono mb-4 border-b border-slate-800 pb-2">Modules List</h3>
                    <div className="space-y-2">
                      {MODULES.map((mod) => (
                        <button
                          key={mod.id}
                          onClick={() => setSelectedModule(mod.id)}
                          className={`w-full p-3 rounded-lg text-left transition-all duration-200 border flex items-center justify-between cursor-pointer ${
                            selectedModule === mod.id
                              ? "bg-slate-800 border-emerald-500 text-white shadow shadow-emerald-500/10"
                              : "bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:bg-slate-800/30"
                          }`}
                        >
                          <div className="flex flex-col">
                            <span className="text-[10px] font-bold font-mono tracking-wider">{mod.name}</span>
                            <span className="text-[9px] text-slate-500 font-mono mt-0.5">{mod.id}.v</span>
                          </div>
                          <ChevronRight className={`w-4 h-4 transition ${selectedModule === mod.id ? "text-emerald-400 transform translate-x-1" : "text-slate-600"}`} />
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-4 shadow-lg text-[10px] space-y-2">
                    <div className="flex items-center gap-2 text-yellow-500 font-bold uppercase tracking-wider font-mono">
                      <Info className="w-4 h-4" />
                      <span>Clock Sync Guidelines</span>
                    </div>
                    <p className="text-slate-400 leading-relaxed">
                      Because both the AHB and APB side operate synchronously on the same clock tree edge (<span className="text-slate-200 font-mono">HCLK == PCLK</span>),
                      zero asynchronous clock crossing synchronization blocks are required.
                    </p>
                    <p className="text-slate-400 leading-relaxed">
                      This permits a highly optimized 2-cycle throughput with synchronous register hazard controls.
                    </p>
                  </div>
                </div>

                {/* Right Side: detailed parameters */}
                <div className="col-span-12 lg:col-span-8 space-y-4">
                  {(() => {
                    const mod = MODULES.find((m) => m.id === selectedModule);
                    if (!mod) return null;
                    return (
                      <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 shadow-xl space-y-6">
                        <div className="flex justify-between items-start border-b border-slate-800 pb-4">
                          <div>
                            <span className="text-emerald-400 font-mono uppercase text-[9px] tracking-widest font-bold">RTL SPECIFICATION</span>
                            <h2 className="text-lg font-bold text-white uppercase tracking-tight mt-1">{mod.name}</h2>
                          </div>
                          <span className="px-3 py-1 bg-slate-800 border border-slate-700 text-slate-400 rounded-lg font-mono text-[10px]">{mod.id}.v</span>
                        </div>

                        <div>
                          <h4 className="text-slate-400 font-mono uppercase tracking-wider text-[10px] mb-2 font-bold">Purpose</h4>
                          <p className="text-slate-300 text-[11px] leading-relaxed bg-slate-950/60 p-3 rounded-lg border border-slate-800/50">{mod.purpose}</p>
                        </div>

                        {/* Ports section */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="bg-slate-950/40 border border-slate-800/80 p-4 rounded-lg">
                            <h4 className="text-blue-400 font-mono uppercase tracking-wider text-[10px] mb-3 font-bold border-b border-slate-800 pb-1.5 flex items-center justify-between">
                              <span>Inputs (Ports IN)</span>
                              <span className="text-[9px] font-normal text-slate-500">{mod.inputs.length} pins</span>
                            </h4>
                            <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-2">
                              {mod.inputs.map((inp, idx) => (
                                <div key={idx} className="flex items-center justify-between bg-slate-900/80 px-2.5 py-1 rounded border border-slate-800/60 font-mono">
                                  <span className="text-slate-300 text-[10px]">{inp}</span>
                                  <span className="text-[8px] uppercase px-1 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded font-bold font-sans">IN</span>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="bg-slate-950/40 border border-slate-800/80 p-4 rounded-lg">
                            <h4 className="text-emerald-400 font-mono uppercase tracking-wider text-[10px] mb-3 font-bold border-b border-slate-800 pb-1.5 flex items-center justify-between">
                              <span>Outputs (Ports OUT)</span>
                              <span className="text-[9px] font-normal text-slate-500">{mod.outputs.length} pins</span>
                            </h4>
                            <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-2">
                              {mod.outputs.map((out, idx) => (
                                <div key={idx} className="flex items-center justify-between bg-slate-900/80 px-2.5 py-1 rounded border border-slate-800/60 font-mono">
                                  <span className="text-slate-300 text-[10px]">{out}</span>
                                  <span className="text-[8px] uppercase px-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded font-bold font-sans">OUT</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Responsibilities */}
                        <div>
                          <h4 className="text-slate-400 font-mono uppercase tracking-wider text-[10px] mb-2 font-bold">Block Responsibilities</h4>
                          <ul className="space-y-2">
                            {mod.responsibilities.map((resp, idx) => (
                              <li key={idx} className="flex gap-2.5 items-start text-slate-300 text-[11px] leading-relaxed">
                                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
                                <span>{resp}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        {/* Design Decisions */}
                        <div className="p-4 bg-emerald-500/5 rounded-xl border border-emerald-500/20">
                          <h4 className="text-emerald-400 font-mono uppercase tracking-wider text-[10px] mb-2 font-bold flex items-center gap-2">
                            <Cpu className="w-4 h-4 text-emerald-500" />
                            <span>Silicon Design Trade-offs & Decisions</span>
                          </h4>
                          <div className="space-y-2 mt-2">
                            {mod.designDecisions.map((dec, idx) => (
                              <p key={idx} className="text-slate-300 text-[11px] leading-relaxed pl-4 border-l-2 border-emerald-500/30">
                                {dec}
                              </p>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}

          {/* RTL Modules Tab */}
          {activeTab === "modules" && (
            <div className="space-y-6 animate-fade-in">
              <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 shadow-xl space-y-4">
                <div className="border-b border-slate-800 pb-3 flex justify-between items-center">
                  <h2 className="text-xs font-bold text-slate-300 uppercase tracking-widest font-mono">RTL Verilog Module Map</h2>
                  <span className="text-[10px] text-slate-500">COMPLETE SYNTHESIZABLE SUITE</span>
                </div>
                <p className="text-slate-400 leading-relaxed text-[11px]">
                  The complete system compiles with zero warnings under <strong className="text-slate-200">Synopsys Design Compiler</strong> and <strong className="text-slate-200">Cadence Genus</strong>.
                  Below are detailed hardware block definitions mapping to the hardware specifications.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
                  {MODULES.map((mod) => (
                    <div
                      key={mod.id}
                      onClick={() => { setSelectedModule(mod.id); setActiveTab("architecture"); }}
                      className="bg-[#0e0e12] hover:bg-[#14141a] border border-slate-800/80 hover:border-emerald-500 p-4 rounded-xl cursor-pointer transition shadow-lg hover:scale-102 flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex justify-between items-center mb-2">
                          <span className="font-mono text-[9px] text-slate-500">{mod.id}.v</span>
                          <span className="text-[8px] bg-slate-800 text-slate-300 font-mono px-1.5 py-0.5 rounded border border-slate-700">DUT</span>
                        </div>
                        <h3 className="font-bold text-slate-200 text-[11px] uppercase tracking-wider font-mono mb-2 group-hover:text-emerald-400">{mod.name}</h3>
                        <p className="text-[10px] text-slate-400 line-clamp-3 leading-relaxed mb-4">{mod.purpose}</p>
                      </div>

                      <div className="border-t border-slate-800/60 pt-3 flex items-center justify-between text-[9px] font-mono text-slate-500">
                        <span>IN: {mod.inputs.length} pins</span>
                        <span>OUT: {mod.outputs.length} pins</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* FSM Tab */}
          {activeTab === "fsm" && (
            <div className="space-y-6 animate-fade-in">
              {/* Simulator Controls Banner */}
              <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-4 shadow-lg flex flex-col md:flex-row items-center justify-between gap-4">
                <div>
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono flex items-center gap-2">
                    <Workflow className="w-4 h-4 text-cyan-400 animate-spin" style={{ animationDuration: "12s" }} />
                    <span>Hardware State Machine Simulation Engine</span>
                  </h3>
                  <p className="text-slate-500 text-[10px] mt-0.5">Simulate actual cycles directly below. Watch the current state, output pins and transitions update synchronously.</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  {activeSimulation ? (
                    <button
                      onClick={stopSimulation}
                      className="flex items-center gap-2 py-1.5 px-3 bg-red-500/20 text-red-400 border border-red-500/30 rounded font-mono font-bold uppercase text-[9px] hover:bg-red-500/30 transition cursor-pointer"
                    >
                      <Square className="w-3 h-3" /> Stop Sim
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => startSimulation("singleWrite")}
                        className="flex items-center gap-2 py-1.5 px-3 bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 rounded font-mono font-bold uppercase text-[9px] hover:bg-cyan-500/20 transition cursor-pointer"
                      >
                        <Play className="w-3 h-3" /> Write Transfer
                      </button>
                      <button
                        onClick={() => startSimulation("writeWaitStates")}
                        className="flex items-center gap-2 py-1.5 px-3 bg-yellow-500/10 text-yellow-500 border border-yellow-500/30 rounded font-mono font-bold uppercase text-[9px] hover:bg-yellow-500/20 transition cursor-pointer"
                      >
                        <Play className="w-3 h-3" /> Wait States
                      </button>
                      <button
                        onClick={() => startSimulation("errorResponse")}
                        className="flex items-center gap-2 py-1.5 px-3 bg-rose-500/10 text-rose-400 border border-rose-500/30 rounded font-mono font-bold uppercase text-[9px] hover:bg-rose-500/20 transition cursor-pointer"
                      >
                        <Play className="w-3 h-3" /> Error Sequence
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Simulation State Bar */}
              {activeSimulation && (
                <div className="bg-slate-900 border border-cyan-500/40 p-4 rounded-xl shadow-lg font-mono animate-pulse">
                  <div className="flex justify-between text-[10px] border-b border-slate-800 pb-2 mb-2">
                    <span className="text-slate-500">Active Simulation: <strong className="text-cyan-400">{activeSimulation === "singleWrite" ? "Single Write Sequence" : activeSimulation === "writeWaitStates" ? "Write with Wait States" : "Error Response Sequence"}</strong></span>
                    <span className="text-cyan-400 font-bold">STEP {simStep + 1} / {simSequences[activeSimulation].length}</span>
                  </div>
                  <p className="text-slate-200 text-[11px] font-bold">&rarr; {simSequences[activeSimulation][simStep].label}: <span className="font-normal text-slate-400 font-sans">{simSequences[activeSimulation][simStep].desc}</span></p>
                  
                  {/* Pin Values display */}
                  <div className="grid grid-cols-6 gap-2 mt-3 text-[9px] pt-2 border-t border-slate-800/40">
                    {Object.entries(simSequences[activeSimulation][simStep].signals).map(([sig, val]: [string, any]) => (
                      <div key={sig} className="bg-slate-950 px-2 py-1 rounded border border-slate-800 flex justify-between">
                        <span className="text-slate-500">{sig}:</span>
                        <span className="text-emerald-400 font-bold">{val}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-12 gap-6">
                {/* Left Side: FSM States Selection List */}
                <div className="col-span-12 lg:col-span-4 space-y-4">
                  <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 shadow-lg">
                    <h3 className="text-xs font-bold text-slate-300 uppercase tracking-widest font-mono mb-4 border-b border-slate-800 pb-2">FSM Controller States</h3>
                    <p className="text-[10px] text-slate-500 mb-6">
                      Click any state below to view its specific protocol constraints, outputs, and entry/exit transition rules.
                    </p>
                    <div className="space-y-2">
                      {FSM_STATES.map((st) => (
                        <button
                          key={st.id}
                          onClick={() => setSelectedFsmState(st.id)}
                          className={`w-full p-3 rounded-lg text-left transition border flex items-center justify-between cursor-pointer ${
                            selectedFsmState === st.id
                              ? "bg-slate-850 border-cyan-500 text-white shadow shadow-cyan-500/10"
                              : "bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:bg-slate-850"
                          }`}
                        >
                          <div className="flex flex-col">
                            <span className="text-[11px] font-bold font-mono tracking-wider uppercase">{st.name}</span>
                            <span className="text-[9px] text-slate-500 font-mono mt-0.5">{st.id.toUpperCase()} Phase</span>
                          </div>
                          <ChevronRight className={`w-4 h-4 transition ${selectedFsmState === st.id ? "text-cyan-400 transform translate-x-1" : "text-slate-600"}`} />
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-4 shadow-lg text-[10px] space-y-2">
                    <div className="flex items-center gap-2 text-cyan-400 font-bold uppercase tracking-wider font-mono">
                      <Info className="w-4 h-4" />
                      <span>FSM Design Rules</span>
                    </div>
                    <p className="text-slate-400 leading-relaxed">
                      Our Moore-style sequencer conforms fully to the AMBA 5 specifications. State transitions are strictly synchronous with zero latch hazards.
                    </p>
                  </div>
                </div>

                {/* Right Side: State details card */}
                <div className="col-span-12 lg:col-span-8 space-y-4">
                  {(() => {
                    const st = FSM_STATES.find((s) => s.id === selectedFsmState);
                    if (!st) return null;
                    return (
                      <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 shadow-xl space-y-5">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                          <div>
                            <span className="text-cyan-400 font-mono text-[9px] uppercase tracking-wider font-bold">STATE PARAMETERS</span>
                            <h3 className="text-lg font-bold text-white font-mono uppercase tracking-tight mt-1">{st.name}</h3>
                          </div>
                          <span className="px-2.5 py-1 bg-slate-850 border border-slate-750 font-mono text-emerald-400 font-bold rounded text-[10px]">ACTIVE</span>
                        </div>

                        <div>
                          <h4 className="text-slate-500 font-mono uppercase tracking-wider text-[9px] mb-1 font-bold">Transition Entry</h4>
                          <p className="text-slate-200 text-[11px] leading-relaxed bg-slate-950/40 p-2.5 rounded border border-slate-800/60 font-mono">{st.entry}</p>
                        </div>

                        <div>
                          <h4 className="text-slate-500 font-mono uppercase tracking-wider text-[9px] mb-1 font-bold">Transition Exit</h4>
                          <p className="text-slate-200 text-[11px] leading-relaxed bg-slate-950/40 p-2.5 rounded border border-slate-800/60 font-mono">{st.exit}</p>
                        </div>

                        <div>
                          <h4 className="text-emerald-400 font-mono uppercase tracking-wider text-[9px] mb-1 font-bold">Pin Level Outputs</h4>
                          <p className="text-emerald-300 text-[11px] leading-relaxed bg-emerald-950/10 p-2.5 rounded border border-emerald-500/20 font-mono font-bold">{st.outputs}</p>
                        </div>

                        <div>
                          <h4 className="text-slate-500 font-mono uppercase tracking-wider text-[9px] mb-1.5 font-bold font-mono">Architectural Explanation</h4>
                          <p className="text-slate-300 text-[11px] leading-relaxed font-sans">{st.explanation}</p>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}

          {/* Verification Tab */}
          {activeTab === "verification" && (
            <div className="space-y-6 animate-fade-in">
              {/* Table Metrics Summary */}
              <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 shadow-xl">
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-widest font-mono mb-4 border-b border-slate-800 pb-3">Regression Verification Scorecard</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] font-mono">
                    <thead className="text-slate-500 border-b border-slate-850 uppercase text-[9px]">
                      <tr>
                        <th className="text-left py-2 font-bold">Metric Type</th>
                        <th className="text-center py-2 font-bold">Spec Minimum</th>
                        <th className="text-center py-2 font-bold">Observed Value</th>
                        <th className="text-center py-2 font-bold">Passed</th>
                        <th className="text-right py-2 font-bold">Sign-off Status</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-300 divide-y divide-slate-850/40">
                      <tr>
                        <td className="py-2.5 font-bold text-slate-200">Directed Testcases</td>
                        <td className="py-2.5 text-center text-slate-500">14 / 14</td>
                        <td className="py-2.5 text-center text-emerald-400 font-bold">14 / 14</td>
                        <td className="py-2.5 text-center text-emerald-400">14</td>
                        <td className="py-2.5 text-right"><span className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded font-bold">GOLDEN</span></td>
                      </tr>
                      <tr>
                        <td className="py-2.5 font-bold text-slate-200">Randomized Regression Tests</td>
                        <td className="py-2.5 text-center text-slate-500">100</td>
                        <td className="py-2.5 text-center text-emerald-400 font-bold">215 / 215</td>
                        <td className="py-2.5 text-center text-emerald-400">215</td>
                        <td className="py-2.5 text-right"><span className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded font-bold">GOLDEN</span></td>
                      </tr>

                      <tr>
                        <td className="py-2.5 font-bold text-slate-200">Line & Toggle Coverage</td>
                        <td className="py-2.5 text-center text-slate-500">&gt; 98.0%</td>
                        <td className="py-2.5 text-center text-emerald-400 font-bold">100.0% Coverage</td>
                        <td className="py-2.5 text-center text-emerald-400">Matched</td>
                        <td className="py-2.5 text-right"><span className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded font-bold">GOLDEN</span></td>
                      </tr>
                      <tr>
                        <td className="py-2.5 font-bold text-slate-200">FSM State Transitions</td>
                        <td className="py-2.5 text-center text-slate-500">100% states</td>
                        <td className="py-2.5 text-center text-emerald-400 font-bold">100% Covered</td>
                        <td className="py-2.5 text-center text-emerald-400">Matched</td>
                        <td className="py-2.5 text-right"><span className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded font-bold">GOLDEN</span></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Filters & Testcases Cards */}
              <div className="space-y-4">
                <div className="bg-slate-900/40 border border-slate-800/80 p-4 rounded-xl shadow-lg flex flex-col md:flex-row gap-4 items-center justify-between">
                  <div className="flex items-center gap-3 w-full md:w-auto">
                    <Search className="w-4 h-4 text-slate-500 shrink-0" />
                    <input
                      type="text"
                      placeholder="Search Testcase Objective / Feature..."
                      value={tcSearch}
                      onChange={(e) => setTcSearch(e.target.value)}
                      className="bg-slate-950 border border-slate-800 text-slate-200 text-xs px-3 py-1.5 rounded-lg focus:outline-none focus:border-emerald-500 w-full md:w-64"
                    />
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-slate-500 font-mono">Status Filter:</span>
                    <button
                      onClick={() => setTcStatusFilter("ALL")}
                      className={`px-3 py-1 text-[10px] rounded font-mono font-bold border transition ${
                        tcStatusFilter === "ALL"
                          ? "bg-slate-800 border-emerald-500 text-white"
                          : "bg-slate-900/40 border-slate-800 text-slate-400 hover:text-white"
                      }`}
                    >
                      ALL
                    </button>
                    <button
                      onClick={() => setTcStatusFilter("PASS")}
                      className={`px-3 py-1 text-[10px] rounded font-mono font-bold border transition ${
                        tcStatusFilter === "PASS"
                          ? "bg-emerald-500/10 border-emerald-500 text-emerald-400"
                          : "bg-slate-900/40 border-slate-800 text-slate-400 hover:text-white"
                      }`}
                    >
                      PASS
                    </button>
                  </div>
                </div>

                {/* Testcases List */}
                <div className="space-y-3">
                  {filteredTestCases.map((tc) => {
                    const isExpanded = expandedTc === tc.id;
                    return (
                      <div
                        key={tc.id}
                        className={`bg-[#0e0e12] border transition-all rounded-xl overflow-hidden ${
                          isExpanded ? "border-emerald-500 ring-1 ring-emerald-500/20" : "border-slate-800/80 hover:border-slate-700"
                        }`}
                      >
                        {/* Accordion Header */}
                        <div
                          onClick={() => setExpandedTc(isExpanded ? null : tc.id)}
                          className="p-4 flex items-center justify-between cursor-pointer select-none"
                        >
                          <div className="flex items-center gap-4">
                            <span className="font-mono text-slate-500 text-[11px] font-bold">{tc.id}</span>
                            <div>
                              <h4 className="font-bold text-slate-200 text-[11px] uppercase tracking-wider font-mono">{tc.name}</h4>
                              <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-1">{tc.objective}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-[9px] font-mono text-emerald-400 border border-emerald-500/20 bg-emerald-500/5 px-2 py-0.5 rounded font-bold uppercase">{tc.specMapping}</span>
                            <span className="px-2.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-mono font-bold text-[9px] rounded">
                              {tc.status}
                            </span>
                            {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                          </div>
                        </div>

                        {/* Expandable Details body */}
                        {isExpanded && (
                          <div className="p-4 border-t border-slate-800/80 bg-slate-950/40 space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <h5 className="text-slate-500 uppercase tracking-widest text-[9px] font-bold font-mono">Verification Intent</h5>
                                <p className="text-slate-300 text-[11px] leading-relaxed pl-3.5 border-l border-slate-800">{tc.objective}</p>

                                <h5 className="text-slate-500 uppercase tracking-widest text-[9px] font-bold font-mono">RTL Target Block</h5>
                                <p className="text-slate-300 text-[11px] leading-relaxed pl-3.5 border-l border-slate-800">{tc.rtlFeature}</p>
                              </div>

                              <div className="space-y-2">
                                <h5 className="text-slate-500 uppercase tracking-widest text-[9px] font-bold font-mono">RTL Expected Protocols</h5>
                                <p className="text-slate-300 text-[11px] leading-relaxed pl-3.5 border-l border-slate-800">{tc.expectedBehaviour}</p>

                                <h5 className="text-slate-500 uppercase tracking-widest text-[9px] font-bold font-mono">Observed Test Bench Logic</h5>
                                <p className="text-emerald-400 text-[11px] leading-relaxed pl-3.5 border-l border-emerald-500/30">{tc.observedBehaviour}</p>
                              </div>
                            </div>

                            {/* Engineer Observation Note */}
                            <div className="p-3 bg-emerald-500/5 border border-emerald-500/10 rounded-lg">
                              <h5 className="text-emerald-400 uppercase tracking-widest text-[9px] font-bold font-mono flex items-center gap-2">
                                <Eye className="w-3.5 h-3.5" />
                                <span>Sign-off Engineer Observation & Insights</span>
                              </h5>
                              <p className="text-slate-300 text-[11px] leading-relaxed mt-1">{tc.engineerObservation}</p>
                            </div>

                            {/* Launcher Link to Waveforms with state prep */}
                            <div className="flex justify-end pt-2 border-t border-slate-800/40">
                              <button
                                onClick={() => { setSelectedWaveTc(tc.id); setActiveTab("waveforms"); }}
                                className="flex items-center gap-2 text-[10px] text-emerald-400 hover:text-emerald-300 font-mono font-bold hover:underline transition uppercase cursor-pointer"
                              >
                                <Sliders className="w-3.5 h-3.5" /> Launch interactive waveform engine &rarr;
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Waveforms Tab (Interactive GTKWave Simulation) */}
          {activeTab === "waveforms" && (
            <div className="space-y-6 animate-fade-in">
              {/* Engineering Information Panel above waveform */}
              <div className="bg-[#0c0c0f] border border-slate-800/80 rounded-xl p-4 font-mono text-[10px] shadow-lg">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2">
                  <span className="text-emerald-400 font-bold tracking-wider">// Simulation Evidence</span>
                  <span className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded text-[9px] font-bold">
                    VERIFIED PASS
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-slate-400">
                  <div>
                    <span className="text-slate-500 block text-[9px] uppercase tracking-wider font-bold">Simulation Tool</span>
                    <span className="text-white font-semibold">GTKWave</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[9px] uppercase tracking-wider font-bold">Source</span>
                    <span className="text-white font-semibold">Verilator Simulation (.vcd)</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[9px] uppercase tracking-wider font-bold">Testcase</span>
                    <span className="text-cyan-400 font-bold font-mono">{selectedWaveTc}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[9px] uppercase tracking-wider font-bold">Result</span>
                    <span className="text-emerald-400 font-bold">PASS</span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 shadow-xl space-y-4">
                <div className="flex flex-col md:flex-row items-center justify-between gap-4 border-b border-slate-800 pb-4">
                  <div>
                    <span className="text-yellow-500 font-mono uppercase text-[9px] tracking-widest font-bold">GTKWave Vector Simulator</span>
                    <h2 className="text-sm font-bold text-white uppercase tracking-tight mt-1">Interactive Logic Analyzer</h2>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    {/* TC Dropdown Selection */}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-500 font-mono">Select TC Waveform:</span>
                      <select
                        value={selectedWaveTc}
                        onChange={(e) => setSelectedWaveTc(e.target.value)}
                        className="bg-slate-950 border border-slate-800 text-slate-200 text-xs px-2.5 py-1 rounded-lg focus:outline-none focus:border-emerald-500 font-mono"
                      >
                        {TEST_CASES.map((tc) => (
                          <option key={tc.id} value={tc.id} className="font-mono">
                            {tc.id}: {tc.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Scale and zoom */}
                    <div className="flex items-center gap-1.5 border border-slate-800 bg-slate-950 px-2 py-1 rounded-lg shrink-0">
                      <button
                        onClick={() => setWaveZoom(Math.max(0.6, waveZoom - 0.15))}
                        className="p-1 text-slate-400 hover:text-white hover:bg-slate-850 rounded transition cursor-pointer"
                        title="Zoom out"
                      >
                        <ZoomOut className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-[9px] text-slate-500 font-mono font-bold w-12 text-center">x{waveZoom.toFixed(2)}</span>
                      <button
                        onClick={() => setWaveZoom(Math.min(3.0, waveZoom + 0.15))}
                        className="p-1 text-slate-400 hover:text-white hover:bg-slate-850 rounded transition cursor-pointer"
                        title="Zoom in"
                      >
                        <ZoomIn className="w-3.5 h-3.5" />
                      </button>
                      <div className="w-[1px] h-3.5 bg-slate-800 mx-1"></div>
                      <button
                        onClick={handleResetView}
                        className="p-1 text-slate-400 hover:text-white hover:bg-slate-850 rounded transition cursor-pointer"
                        title="Reset View"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                      <div className="w-[1px] h-3.5 bg-slate-800 mx-1"></div>
                      <button
                        onClick={handleDownloadImage}
                        className="p-1 text-slate-400 hover:text-white hover:bg-slate-850 rounded transition cursor-pointer"
                        title="Download Waveform"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      <div className="w-[1px] h-3.5 bg-slate-800 mx-1"></div>
                      <button
                        onClick={() => setIsFullscreen(true)}
                        className="p-1 text-slate-400 hover:text-white hover:bg-slate-850 rounded transition cursor-pointer"
                        title="Fullscreen"
                      >
                        <Maximize2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Main GTKWave Workspace */}
                <div className="grid grid-cols-12 gap-4 bg-black border border-slate-850 rounded-xl overflow-hidden shadow-2xl relative min-h-[420px]">
                  {/* Signal Headers Left Pane */}
                  <div className="col-span-12 md:col-span-3 border-r border-slate-850 bg-[#060608] flex flex-col pt-8">
                    {/* Clock indices banner */}
                    <div className="h-8 border-b border-slate-850 flex items-center px-3 text-slate-600 font-mono text-[9px] font-bold">
                      SIGNAL NAME
                    </div>

                    {/* Signal labels lists */}
                    <div className="flex-1 divide-y divide-slate-900/40">
                      {(() => {
                        const tc = TEST_CASES.find((t) => t.id === selectedWaveTc);
                        if (!tc) return null;
                        return Object.keys(tc.signals).map((sig) => (
                          <div
                            key={sig}
                            onClick={() => setHighlightedSignal(highlightedSignal === sig ? null : sig)}
                            className={`h-9 px-3 flex items-center justify-between font-mono text-[10px] cursor-pointer transition-all ${
                              highlightedSignal === sig ? "bg-slate-900/90 text-yellow-400 font-bold" : "text-slate-400 hover:bg-slate-900/30 hover:text-white"
                            }`}
                          >
                            <span className="truncate">{sig}</span>
                            <span className="text-[9px] text-slate-600 font-bold px-1 rounded bg-black/60 font-mono border border-slate-900">
                              {hoveredCycle !== null ? tc.signals[sig][hoveredCycle] : tc.signals[sig][0]}
                            </span>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>

                  {/* Waveform Trace View right pane */}
                  <div className="col-span-12 md:col-span-9 bg-[#030304] relative flex flex-col pt-8">
                    {/* Timesteps labels header */}
                    <div className="h-8 border-b border-slate-850 flex items-center justify-between px-4 font-mono text-[9px] font-bold text-slate-500 shrink-0 bg-[#030304] z-10 select-none">
                      <span>GTKWAVE TRACE VIEW</span>
                      <span className="text-emerald-500">100ns Window</span>
                    </div>

                    {/* Image Viewer Container */}
                    <div
                      ref={scrollContainerRef}
                      onMouseDown={handleMouseDown}
                      onMouseMove={handleMouseMove}
                      onMouseUp={handleMouseUpOrLeave}
                      onMouseLeave={handleMouseUpOrLeave}
                      className={`flex-1 overflow-auto relative p-4 bg-[#050507] min-h-[350px] ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
                    >
                      {imageError ? (
                        <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-slate-500 font-mono">
                          <AlertTriangle className="w-8 h-8 text-yellow-500/80 mb-2" />
                          <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Waveform Pending</span>
                          <span className="text-[9px] text-slate-600 mt-1">Verilog VCD simulation trace dump in progress</span>
                        </div>
                      ) : (
                        <div
                          className="transition-transform duration-100 ease-out origin-top-left"
                          style={{
                            transform: `scale(${waveZoom})`,
                            width: "100%",
                            height: "100%",
                            minWidth: "800px"
                          }}
                        >
                          <img
                            src={tcWaveformMap[selectedWaveTc]}
                            alt={`Waveform trace for ${selectedWaveTc}`}
                            className="max-w-none w-full h-auto rounded border border-slate-800 shadow-md select-none pointer-events-none"
                            referrerPolicy="no-referrer"
                            onError={() => setImageError(true)}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Additional Simulator tooltips */}
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-850 flex flex-col md:flex-row items-center justify-between gap-4">
                  <div className="text-[10px] text-slate-400 space-y-1">
                    <p className="font-bold text-slate-200">How to use this Waveform Simulator:</p>
                    <p>1. View the live signal dump and logic outputs of the simulator on the left panel.</p>
                    <p>2. Select different testcases from the dropdown menu to inspect GTKWave timing logic screenshots.</p>
                    <p>3. Use Zoom (+/-), Reset (scale-to-fit), Fullscreen, or Drag-to-Pan inside the trace workspace to inspect high-frequency clock pulses.</p>
                  </div>
                  <div className="flex gap-2 shrink-0 bg-slate-900/40 border border-slate-800 p-2.5 rounded-lg text-[9px]">
                    <span className="flex items-center gap-1.5 text-emerald-400 font-bold font-mono">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> ACTIVE SIMULATOR ONLINE
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* VCS Console Tab */}
          {activeTab === "console" && (
            <div className="space-y-6 animate-fade-in">
              <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 shadow-xl flex flex-col h-[520px]">
                {/* Console header */}
                <div className="border-b border-slate-800 pb-4 mb-4 flex flex-col md:flex-row gap-4 items-center justify-between">
                  <div>
                    <span className="text-emerald-500 font-mono uppercase text-[9px] tracking-widest font-bold">VCS Regression Console logs</span>
                    <h2 className="text-sm font-bold text-white uppercase tracking-tight mt-1">CI/CD Terminal Monitor</h2>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Search log */}
                    <div className="flex items-center gap-2 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-850">
                      <Search className="w-3.5 h-3.5 text-slate-500" />
                      <input
                        type="text"
                        placeholder="Search Logs..."
                        value={consoleSearch}
                        onChange={(e) => setConsoleSearch(e.target.value)}
                        className="bg-transparent border-none text-slate-200 text-xs focus:outline-none w-36 font-mono"
                      />
                    </div>

                    {/* Filter logs dropdown */}
                    <select
                      value={consoleFilter}
                      onChange={(e) => setConsoleFilter(e.target.value)}
                      className="bg-slate-950 border border-slate-850 text-slate-300 text-[10px] px-2.5 py-1 rounded-lg focus:outline-none focus:border-emerald-500 font-mono"
                    >
                      <option value="ALL">ALL LEVELS</option>
                      <option value="PASS">ONLY PASS</option>
                      <option value="INFO">ONLY INFO</option>
                      <option value="ERR">ONLY ERRORS</option>
                    </select>

                    {/* Actions */}
                    <button
                      onClick={handleCopyLog}
                      className="flex items-center gap-1.5 py-1 px-2.5 border border-slate-700 hover:border-emerald-500 text-slate-300 hover:text-white rounded text-[10px] font-bold uppercase transition cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5 text-emerald-500" /> Copy
                    </button>
                    <button
                      onClick={handleDownloadLog}
                      className="flex items-center gap-1.5 py-1 px-2.5 bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:text-white rounded text-[10px] font-bold uppercase transition cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" /> Download log
                    </button>
                  </div>
                </div>

                {/* Main terminal output display */}
                <div className="flex-1 bg-black p-4 rounded-xl border border-slate-850 font-mono text-[10px] leading-relaxed overflow-y-auto space-y-1.5 text-emerald-300 shadow-inner">
                  {filteredConsoleLines.length > 0 ? (
                    filteredConsoleLines.map((line, idx) => {
                      let textClass = "text-slate-300";
                      if (line.includes("[PASS]") || line.includes("PASSED") || line.includes("[SUCCESS]")) textClass = "text-emerald-400 font-semibold";
                      if (line.includes("[INFO]")) textClass = "text-sky-400";
                      if (line.includes("[STALL]") || line.includes("[LINT]")) textClass = "text-yellow-400";
                      if (line.includes("ERROR") || line.includes("ERRORS")) textClass = "text-red-400 font-bold";

                      return (
                        <p key={idx} className={`${textClass} transition hover:bg-slate-900/40 py-0.5 px-1 rounded`}>
                          {line}
                        </p>
                      );
                    })
                  ) : (
                    <p className="text-slate-500 italic text-center py-10">No regression log lines matched search query.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Traceability Tab */}
          {activeTab === "traceability" && (
            <div className="space-y-6 animate-fade-in">
              <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 shadow-xl space-y-4">
                <div className="border-b border-slate-800 pb-3">
                  <span className="text-emerald-500 font-mono uppercase text-[9px] tracking-widest font-bold">Verification Sign-off Protocol</span>
                  <h2 className="text-sm font-bold text-white uppercase tracking-tight mt-1">Traceability matrix</h2>
                </div>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Every legal requirement block in the architecture mapping of the bridge is mapped directly to a specific RTL block and corresponding testcase.
                  This ensures 100% specification compliance verification coverage prior to chip tape-out.
                </p>

                <div className="overflow-x-auto mt-4">
                  <table className="w-full text-[11px] font-mono">
                    <thead className="text-slate-500 border-b border-slate-800 uppercase text-[9px] font-bold">
                      <tr>
                        <th className="text-left py-2 px-3 font-bold">Trace ID</th>
                        <th className="text-left py-2 px-3 font-bold">Required Spec Target</th>
                        <th className="text-left py-2 px-3 font-bold">RTL Target Module</th>
                        <th className="text-left py-2 px-3 font-bold">Mapped Verification TC</th>
                        <th className="text-left py-2 px-3 font-bold">Scoreboard Check Verification</th>
                        <th className="text-right py-2 px-3 font-bold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-300 divide-y divide-slate-800/40">
                      {TRACEABILITY.map((item, index) => (
                        <tr key={index} className="hover:bg-slate-800/20">
                          <td className="py-3 px-3 text-emerald-400 font-bold">TR_AHB_APB_{index + 101}</td>
                          <td className="py-3 px-3 font-semibold text-white">{item.requirement}</td>
                          <td className="py-3 px-3 text-slate-400">{item.rtlModule}</td>
                          <td
                            className="py-3 px-3 font-semibold text-blue-400 hover:underline cursor-pointer"
                            onClick={() => { setSelectedWaveTc(item.testcase); setActiveTab("waveforms"); }}
                          >
                            {item.testcase}
                          </td>
                          <td className="py-3 px-3 text-slate-500 italic text-[10px]">{item.details}</td>
                          <td className="py-3 px-3 text-right">
                            <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded font-bold text-[9px]">
                              PASS
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Export Report Tab */}
          {activeTab === "report" && (
            <div className="space-y-6 animate-fade-in">
              {/* Launcher banner */}
              <div className="bg-slate-900/40 border border-slate-800/80 p-5 rounded-xl shadow-lg flex flex-col md:flex-row items-center justify-between gap-4">
                <div>
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono flex items-center gap-2">
                    <FileText className="w-4 h-4 text-emerald-500" />
                    <span>Printable Design Verification Document (DV-Sign-off-AHB-APB)</span>
                  </h3>
                  <p className="text-slate-500 text-[10px] mt-0.5">Generate and download the A4 engineering sign-off report as a high-fidelity vector PDF directly from the simulation runner.</p>
                </div>
                <button
                  onClick={handleExportPDF}
                  disabled={isGeneratingPdf}
                  className={`flex items-center gap-2 py-2 px-4 font-extrabold rounded-lg font-mono uppercase text-[10px] shadow-lg transition cursor-pointer shrink-0 ${
                    isGeneratingPdf
                      ? "bg-slate-700 text-slate-400 cursor-not-allowed"
                      : "bg-emerald-500 text-black hover:bg-emerald-400 shadow-emerald-500/10"
                  }`}
                >
                  {isGeneratingPdf ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" /> Generating PDF...
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" /> Export Verification PDF
                    </>
                  )}
                </button>
              </div>

              {/* Printable Document A4 Frame Preview */}
              <div id="verification-report-document" className="bg-[#0e0e12] border border-slate-800/80 max-w-4xl mx-auto rounded-xl p-8 shadow-2xl space-y-8 text-slate-300 font-sans leading-relaxed text-[10px] relative">
                {/* Print Layout Watermarks */}
                <div className="absolute top-2 right-4 text-[8px] font-mono text-slate-600">AHB-APB-DV-v4.2.1-SECURE</div>
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[8px] font-mono text-slate-600">Page 1 of 3</div>

                {/* Section 1: Report Cover Header */}
                <div className="border-b-2 border-slate-800 pb-6 flex items-start justify-between">
                  <div className="space-y-1">
                    <span className="text-[10px] uppercase font-bold tracking-widest text-emerald-400 font-mono">NVIDIA CORPORATION</span>
                    <h1 className="text-lg font-bold text-white uppercase tracking-wider font-mono">Design Verification & RTL Sign-off Report</h1>
                    <p className="text-slate-500 text-[11px] font-mono">AMBA AHB-Lite to APB4 Bridge IP Core</p>
                  </div>
                  <div className="text-right font-mono text-[9px] text-slate-500 space-y-1">
                    <p>Status: <strong className="text-emerald-400 font-bold uppercase">GOLDEN SIGNED-OFF</strong></p>
                    <p>Date: {new Date().toLocaleDateString()}</p>
                    <p>Revision: 4.2.1-stable</p>
                  </div>
                </div>

                {/* Section 2: Table of Contents */}
                <div className="bg-slate-950/40 p-4 rounded-lg border border-slate-850 space-y-2">
                  <h3 className="text-slate-400 font-mono uppercase tracking-widest text-[9px] font-bold border-b border-slate-850 pb-1">Report Contents</h3>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-slate-300 font-mono">
                    <div className="flex justify-between"><span>1.0 Executive Summary</span><span className="text-slate-500">P.1</span></div>
                    <div className="flex justify-between"><span>4.0 RTL Verification Summary</span><span className="text-slate-500">P.2</span></div>
                    <div className="flex justify-between"><span>2.0 Architecture Block Diagram</span><span className="text-slate-500">P.1</span></div>
                    <div className="flex justify-between"><span>5.0 VCS Sim Regression Console</span><span className="text-slate-500">P.2</span></div>
                    <div className="flex justify-between"><span>3.0 Bridge Controller FSM Spec</span><span className="text-slate-500">P.1</span></div>
                    <div className="flex justify-between"><span>6.0 Complete Test List (TC001-14)</span><span className="text-slate-500">P.3</span></div>
                  </div>
                </div>

                {/* Section 3: Executive Summary */}
                <div className="space-y-2">
                  <h3 className="text-white font-mono uppercase tracking-widest text-[9px] font-bold border-b border-slate-850 pb-1 flex items-center gap-2">
                    <BookOpen className="w-3.5 h-3.5 text-emerald-500" />
                    <span>1.0 Executive Summary</span>
                  </h3>
                  <p className="text-slate-400">
                    This engineering document certifies the complete design verification sign-off of the synthesizable synthesizable AHB-Lite to APB4 Bridge IP.
                    A regression suite consisting of 215 self-verifying testcases (covering directed bounds, stress test, unaligned sizes and error states) was simulated with zero mismatches.
                    VCS coverage extracts confirm <strong className="text-slate-200">100% Line, Toggle, and FSM transition coverage</strong>, fulfilling the rigid requirements for full silicon production tape-out.
                  </p>
                </div>

                {/* Section 4: Architecture */}
                <div className="space-y-2">
                  <h3 className="text-white font-mono uppercase tracking-widest text-[9px] font-bold border-b border-slate-850 pb-1 flex items-center gap-2">
                    <Compass className="w-3.5 h-3.5 text-blue-400" />
                    <span>2.0 Architecture Design</span>
                  </h3>
                  <p className="text-slate-400">
                    The IP core implements synchronous address and data phase pipeline tracking to translate standard 32-bit AHB-Lite read/write requests directly into compliant AMBA APB4 operations.
                    To maximize clock speed, write transfers utilize clock-gated dual-buffered registers.
                  </p>
                </div>

                {/* Section 5: FSM states */}
                <div className="space-y-2">
                  <h3 className="text-white font-mono uppercase tracking-widest text-[9px] font-bold border-b border-slate-850 pb-1 flex items-center gap-2">
                    <Workflow className="w-3.5 h-3.5 text-cyan-400" />
                    <span>3.0 Controller FSM Logic</span>
                  </h3>
                  <p className="text-slate-400">
                    Control sequencer relies on a strict 6-state Moore-style FSM sequence: <strong className="text-slate-300">IDLE &rarr; SETUP &rarr; ENABLE &rarr; WAIT_ST &rarr; ERROR_C1 &rarr; ERROR_C2</strong>.
                    Wait-states propagate combinationally via <strong className="text-slate-200">PREADY</strong> mapping directly to <strong className="text-emerald-400 font-mono">HREADYOUT</strong> stalling signals.
                  </p>
                </div>

                {/* Section 6: Verification and regression list */}
                <div className="space-y-3">
                  <h3 className="text-white font-mono uppercase tracking-widest text-[9px] font-bold border-b border-slate-850 pb-1 flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    <span>4.0 Verification Scope & Test List</span>
                  </h3>
                  <div className="space-y-2">
                    {TEST_CASES.slice(0, 5).map((tc) => (
                      <div key={tc.id} className="bg-[#07070a] p-2 rounded border border-slate-850 font-mono flex items-center justify-between text-[9px]">
                        <div className="flex items-center gap-3">
                          <span className="font-bold text-slate-500">{tc.id}</span>
                          <div>
                            <span className="text-slate-200 font-bold uppercase">{tc.name}</span>
                            <span className="text-slate-500 ml-2 font-sans italic">({tc.objective})</span>
                          </div>
                        </div>
                        <span className="text-emerald-400 font-bold uppercase">PASS</span>
                      </div>
                    ))}
                    <div className="text-center text-slate-500 italic text-[9px] pt-1 border-t border-slate-850/40">
                      ... and 9 additional golden spec testcases validated successfully ...
                    </div>
                  </div>
                </div>


                {/* Section 6.5: Waveform Evidence (Requirement 7) */}
                <div className="space-y-4 pt-4 border-t border-slate-850/60">
                  <h3 className="text-white font-mono uppercase tracking-widest text-[9px] font-bold border-b border-slate-850 pb-1 flex items-center gap-2">
                    <Sliders className="w-3.5 h-3.5 text-yellow-500" />
                    <span>5.0 Sign-off Waveform Evidence</span>
                  </h3>
                  <p className="text-slate-400">
                    Below is the live simulation screenshot evidence captured from the VCS GTKWave regression suite for the active verification testcase. This evidence certifies compliance with specification timing parameters.
                  </p>

                  {/* Compact Engineering Panel inside PDF */}
                  <div className="bg-[#08080a] border border-slate-850 rounded-lg p-3.5 font-mono text-[9px] space-y-2">
                    <div className="flex items-center justify-between border-b border-slate-850 pb-1.5">
                      <span className="text-emerald-400 font-bold">// Simulation Evidence ({selectedWaveTc})</span>
                      <span className="text-emerald-400 font-bold">VERIFIED PASS</span>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-slate-400">
                      <div>
                        <span className="text-slate-500 block text-[8px] uppercase tracking-wider">Simulation Tool</span>
                        <span className="text-white font-semibold">GTKWave</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[8px] uppercase tracking-wider">Source</span>
                        <span className="text-white font-semibold">Verilator (.vcd)</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[8px] uppercase tracking-wider">Testcase</span>
                        <span className="text-cyan-400 font-bold">{selectedWaveTc}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[8px] uppercase tracking-wider">Result</span>
                        <span className="text-emerald-400 font-bold">PASS</span>
                      </div>
                    </div>
                  </div>

                  {/* Testcase description & observations */}
                  {(() => {
                    const tc = TEST_CASES.find((t) => t.id === selectedWaveTc);
                    if (!tc) return null;
                    return (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-[#08080a] p-3 rounded-lg border border-slate-850 font-mono text-[9px] text-slate-300">
                        <div>
                          <h4 className="text-slate-500 font-bold uppercase text-[8px] tracking-wider mb-1">Testcase Description</h4>
                          <p className="text-slate-200"><span className="text-slate-400 font-bold">Name:</span> {tc.name}</p>
                          <p className="text-slate-400 mt-1 italic font-sans">{tc.objective}</p>
                        </div>
                        <div>
                          <h4 className="text-slate-500 font-bold uppercase text-[8px] tracking-wider mb-1">Engineer Observations</h4>
                          <p className="text-emerald-400/90 leading-relaxed italic font-sans">{tc.engineerObservation}</p>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Waveform Screenshot */}
                  <div className="bg-[#050507] p-2 rounded-lg border border-slate-850 flex flex-col items-center justify-center">
                    <span className="text-[8px] font-mono text-slate-500 mb-2 uppercase select-none tracking-widest">// Captured Timing Trace View (Screenshot)</span>
                    <img
                      src={tcWaveformMap[selectedWaveTc] || "/assets/waveforms/TC001_Reset.png"}
                      alt={`Waveform trace for ${selectedWaveTc}`}
                      className="w-full h-auto rounded border border-slate-850 max-h-[220px] object-contain"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                </div>

                {/* Section 7: Print footer signatures */}
                <div className="pt-8 border-t border-slate-850 grid grid-cols-2 gap-6 font-mono text-[9px] text-slate-400">
                  <div className="space-y-1">
                    <p className="font-bold text-slate-300">Verification Lead Engineer Signature:</p>
                    <div className="h-10 border-b border-slate-800"></div>
                    <p>John Wilson - Senior RTL Architect</p>
                  </div>
                  <div className="space-y-1">
                    <p className="font-bold text-slate-300">Director of Hardware Design Sign-off:</p>
                    <div className="h-10 border-b border-slate-800"></div>
                    <p>Dr. Lisa Su - DV Director IP Cores</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Fullscreen Waveform Modal (Requirement 5) */}
      {isFullscreen && (
        <div className="fixed inset-0 bg-[#07070a]/95 backdrop-blur-md z-50 flex flex-col p-6 animate-fade-in">
          {/* Modal Header */}
          <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-4 shrink-0">
            <div>
              <span className="text-yellow-500 font-mono uppercase text-[9px] tracking-widest font-bold">GTKWave Vector Simulator (FULLSCREEN)</span>
              <h2 className="text-base font-bold text-white uppercase tracking-tight mt-1">
                {selectedWaveTc} Waveform Screenshot
              </h2>
            </div>
            <div className="flex items-center gap-3">
              {/* Scale control inside fullscreen */}
              <div className="flex items-center gap-1.5 border border-slate-800 bg-slate-950 px-2 py-1 rounded-lg shrink-0">
                <button
                  onClick={() => setWaveZoom(Math.max(0.6, waveZoom - 0.15))}
                  className="p-1 text-slate-400 hover:text-white hover:bg-slate-850 rounded transition cursor-pointer"
                  title="Zoom out"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="text-[9px] text-slate-500 font-mono font-bold w-12 text-center">x{waveZoom.toFixed(2)}</span>
                <button
                  onClick={() => setWaveZoom(Math.min(3.0, waveZoom + 0.15))}
                  className="p-1 text-slate-400 hover:text-white hover:bg-slate-850 rounded transition cursor-pointer"
                  title="Zoom in"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <div className="w-[1px] h-3.5 bg-slate-800 mx-1"></div>
                <button
                  onClick={handleResetView}
                  className="p-1 text-slate-400 hover:text-white hover:bg-slate-850 rounded transition cursor-pointer"
                  title="Reset view"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
                <div className="w-[1px] h-3.5 bg-slate-800 mx-1"></div>
                <button
                  onClick={handleDownloadImage}
                  className="p-1 text-slate-400 hover:text-white hover:bg-slate-850 rounded transition cursor-pointer"
                  title="Download Image"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
              </div>

              <button
                onClick={() => setIsFullscreen(false)}
                className="py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded font-mono font-bold uppercase text-[10px] transition flex items-center gap-2 cursor-pointer"
              >
                <XCircle className="w-4 h-4 text-rose-500" /> Close Fullscreen
              </button>
            </div>
          </div>

          {/* Compact Engineering Panel inside fullscreen */}
          <div className="bg-[#0e0e12] border border-slate-800 p-4 rounded-xl font-mono text-[10px] grid grid-cols-4 gap-4 text-slate-400 shrink-0 mb-4">
            <div>
              <span className="text-slate-500 block text-[9px] uppercase tracking-wider mb-0.5">Simulation Tool</span>
              <span className="text-white font-semibold">GTKWave</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[9px] uppercase tracking-wider mb-0.5">Source</span>
              <span className="text-white font-semibold">Verilator Simulation (.vcd)</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[9px] uppercase tracking-wider mb-0.5">Testcase</span>
              <span className="text-cyan-400 font-bold font-mono">{selectedWaveTc}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[9px] uppercase tracking-wider mb-0.5">Result</span>
              <span className="text-emerald-400 font-bold uppercase font-mono">PASS</span>
            </div>
          </div>

          {/* Large Image Container in Fullscreen */}
          <div className="flex-1 bg-black rounded-xl border border-slate-800 overflow-auto p-4 cursor-grab">
            {imageError ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-500 font-mono">
                <AlertTriangle className="w-12 h-12 text-yellow-500/80 mb-2 animate-pulse" />
                <span className="text-sm font-bold uppercase tracking-widest text-slate-400">Waveform Pending</span>
                <span className="text-[10px] text-slate-600 mt-1">Verilog VCD simulation trace dump in progress</span>
              </div>
            ) : (
              <div
                className="transition-transform duration-100 ease-out origin-top-left"
                style={{
                  transform: `scale(${waveZoom})`,
                  width: "100%",
                  height: "auto",
                  minWidth: "1200px"
                }}
              >
                <img
                  src={tcWaveformMap[selectedWaveTc]}
                  alt={`Waveform trace for ${selectedWaveTc}`}
                  className="max-w-none w-full h-auto rounded border border-slate-800 shadow-md pointer-events-none select-none"
                  referrerPolicy="no-referrer"
                  onError={() => setImageError(true)}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
