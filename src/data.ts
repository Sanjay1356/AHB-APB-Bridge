export interface TestCase {
  id: string;
  name: string;
  objective: string;
  rtlFeature: string;
  expectedBehaviour: string;
  observedBehaviour: string;
  status: 'PASS' | 'FAIL' | 'WAIT';
  specMapping: string;
  engineerObservation: string;
  signals: {
    [signalName: string]: string[]; // array of values for cycles 0 to 9
  };
}

export interface FsmState {
  id: string;
  name: string;
  entry: string;
  exit: string;
  outputs: string;
  explanation: string;
}

export interface RtlModule {
  id: string;
  name: string;
  purpose: string;
  inputs: string[];
  outputs: string[];
  responsibilities: string[];
  designDecisions: string[];
}

export interface TraceabilityItem {
  requirement: string;
  rtlModule: string;
  testcase: string;
  details: string;
}

export const MODULES: RtlModule[] = [
  {
    id: "ahb_slave",
    name: "AHB Slave Interface",
    purpose: "Handles interface protocols on the high-performance system bus, latches incoming transfers, and controls the pipeline stalls via HREADYOUT.",
    inputs: ["HCLK", "HRESETn", "HSEL", "HADDR[31:0]", "HWRITE", "HTRANS[1:0]", "HSIZE[2:0]", "HWDATA[31:0]", "HREADY"],
    outputs: ["HREADYOUT", "HRESP", "hr_data_latched[31:0]", "addr_latched[31:0]", "write_latched", "trans_latched[1:0]"],
    responsibilities: [
      "Decode HSEL and HTRANS to detect valid non-sequential or sequential transfers.",
      "Support standard AHB pipeline: latch address/control in Address Phase, then sample HWDATA in Data Phase.",
      "Stall the AHB master by driving HREADYOUT = 0 when APB transfer is in progress (Setup/Access states)."
    ],
    designDecisions: [
      "Address & control signals latched inside single-cycle registers to shield high-speed AHB logic from slower APB peripheral delays.",
      "HREADYOUT is registered to prevent combinational feedback loops between the APB wait state logic (PREADY) and AHB masters."
    ]
  },
  {
    id: "write_reg",
    name: "Write Data Register",
    purpose: "Buffer register holding the data to be written during the APB data phase.",
    inputs: ["HCLK", "HRESETn", "HWDATA[31:0]", "write_en"],
    outputs: ["hwdata_buffered[31:0]"],
    responsibilities: [
      "Store HWDATA at the end of the AHB data phase.",
      "Keep PWDATA stable and valid during both SETUP and ENABLE phases of the APB4 write cycle."
    ],
    designDecisions: [
      "Clock-gated write enable register used to reduce dynamic power when there are no active write transactions."
    ]
  },
  {
    id: "bridge_fsm",
    name: "Bridge Controller FSM",
    purpose: "The core logic orchestrating the translation of AHB transfers to APB4 transactions. Sequences state transitions and generates control signals.",
    inputs: ["HCLK", "HRESETn", "valid_transfer", "write_latched", "PREADY", "PSLVERR"],
    outputs: ["fsm_state[2:0]", "penable_en", "psel_en", "hready_out_control", "hresp_control"],
    responsibilities: [
      "Enforce precise APB4 protocol timing: 1 cycle for SETUP, at least 1 cycle for ENABLE.",
      "Sequence APB wait-states by remaining in ENABLE/WAIT_ST if PREADY is low.",
      "Handle transfer error responses with 2-cycle HRESP signaling."
    ],
    designDecisions: [
      "Three-always-block design (state register, next-state combo, output combo) implemented for maximal readability and clean lint results.",
      "A dedicated wait-state logic block is embedded to handle slower APB slave devices gracefully."
    ]
  },
  {
    id: "apb_master",
    name: "APB Master Interface",
    purpose: "Translates latched internal AHB parameters into standard, compliant APB4 protocol outputs driving the target peripherals.",
    inputs: ["HCLK", "HRESETn", "fsm_state[2:0]", "addr_latched[31:0]", "hwdata_buffered[31:0]", "write_latched", "hsize_latched[2:0]"],
    outputs: ["PSEL", "PENABLE", "PWRITE", "PADDR[31:0]", "PWDATA[31:0]", "PSTRB[3:0]", "PROT[2:0]"],
    responsibilities: [
      "Drive PSEL high when entering APB SETUP, maintain high during ENABLE/WAIT_ST.",
      "Assert PENABLE during APB ENABLE phase.",
      "Perform write strobe (PSTRB) decoding using latched low address bits and HSIZE transfer size parameters.",
      "Drive PROT protection parameters mapping AHB non-secure/privilege levels directly to APB4."
    ],
    designDecisions: [
      "Combinational generation of PADDR/PWDATA directly from registers to eliminate redundant pipeline latency and enable 2-cycle back-to-back operations."
    ]
  },
  {
    id: "apb_peripheral",
    name: "APB Target Peripheral (Mock/DUT)",
    purpose: "Simulated or actual external register file / memory space used to respond to reads/writes, generate wait states, and trigger error responses.",
    inputs: ["PCLK", "PRESETn", "PSEL", "PENABLE", "PWRITE", "PADDR[31:0]", "PWDATA[31:0]", "PSTRB[3:0]"],
    outputs: ["PRDATA[31:0]", "PREADY", "PSLVERR"],
    responsibilities: [
      "Decode address to access internal memory elements.",
      "Acknowledge writes with byte-strobe accuracy.",
      "Stall reads or writes using programmable wait states (assert/de-assert PREADY).",
      "Assert PSLVERR for out-of-bounds address access or privilege violations."
    ],
    designDecisions: [
      "Configurable behavior matrix with programmable PREADY delays to support robust boundary coverage and randomized testing."
    ]
  }
];

export const FSM_STATES: FsmState[] = [
  {
    id: "idle",
    name: "IDLE",
    entry: "Default state after HRESETn assertions or when no AHB transfer is active (HTRANS == IDLE/BUSY).",
    exit: "Triggered when HSEL is high, HTRANS is NONSEQ/SEQ, and HREADY is high. Transition to SETUP.",
    outputs: "PSEL = 0, PENABLE = 0, HREADYOUT = 1, HRESP = OKAY",
    explanation: "Bridge is waiting for an incoming transaction. High-speed AHB bus passes through unhindered; HREADYOUT is held active, signaling to the masters that the bridge is available."
  },
  {
    id: "setup",
    name: "SETUP",
    entry: "Entered from IDLE (or ENABLE if back-to-back). Latch signals are fully valid.",
    exit: "Unconditional transition to ENABLE on the next rising edge of HCLK.",
    outputs: "PSEL = 1, PENABLE = 0, HREADYOUT = 0 (stalling AHB), HRESP = OKAY",
    explanation: "The first phase of APB cycle. Drive address and control outputs (PADDR, PWRITE, PSTRB) and assert PSEL for the target peripheral. HREADYOUT is deasserted to hold the AHB master in its data phase."
  },
  {
    id: "enable",
    name: "ENABLE",
    entry: "Entered from SETUP after precisely one HCLK cycle.",
    exit: "Transition to IDLE (if transfer finishes and no pending), to SETUP (if back-to-back write), or to WAIT_ST (if PREADY == 0).",
    outputs: "PSEL = 1, PENABLE = 1, HREADYOUT = PREADY, HRESP = OKAY/ERROR",
    explanation: "The Access phase of the APB cycle. PENABLE is driven high. If PREADY is high, data is transferred on the rising edge of HCLK, completing the transaction. HREADYOUT copies PREADY directly to release the AHB master immediately."
  },
  {
    id: "wait_st",
    name: "WAIT_ST",
    entry: "Entered from ENABLE if the APB peripheral deasserts PREADY (PREADY == 0), signaling wait states.",
    exit: "Remains in WAIT_ST as long as PREADY == 0. Transitions back to ENABLE or IDLE on the cycle after PREADY becomes 1.",
    outputs: "PSEL = 1, PENABLE = 1, HREADYOUT = 0 (maintains stall), HRESP = OKAY",
    explanation: "Handles slow APB peripherals. Keeps PSEL and PENABLE high, forcing the AHB Master to remain stalled while the slower peripheral takes multiple clock cycles to ready its data/latch buffers."
  },
  {
    id: "error_c1",
    name: "ERROR_C1",
    entry: "Entered from ENABLE or WAIT_ST if the APB target asserts an error response (PSLVERR == 1) and PREADY == 1.",
    exit: "Unconditional transition to ERROR_C2 on next HCLK cycle.",
    outputs: "PSEL = 0, PENABLE = 0, HREADYOUT = 0, HRESP = ERROR",
    explanation: "The first cycle of the standard AHB 2-cycle Error Response sequence. Drive HRESP to ERROR and maintain HREADYOUT at 0 to notify the master."
  },
  {
    id: "error_c2",
    name: "ERROR_C2",
    entry: "Entered from ERROR_C1 after precisely one HCLK cycle.",
    exit: "Unconditional transition back to IDLE.",
    outputs: "PSEL = 0, PENABLE = 0, HREADYOUT = 1, HRESP = ERROR",
    explanation: "The second cycle of the AHB Error Response. HRESP is held at ERROR, while HREADYOUT is driven high. This releases the master, allowing it to complete the aborted transaction and handle the exception."
  }
];

export const TRACEABILITY: TraceabilityItem[] = [
  {
    requirement: "Wait State Handling",
    rtlModule: "Bridge FSM",
    testcase: "TC006",
    details: "Supports APB4 wait states where PREADY goes low. The FSM transitions to WAIT_ST, stalls AHB (HREADYOUT=0), and resumes when PREADY is high."
  },
  {
    requirement: "Error Response Protocol",
    rtlModule: "Bridge FSM",
    testcase: "TC011",
    details: "Translate APB PSLVERR assertions into full 2-cycle AHB HRESP = ERROR sequences (ERROR_C1 to ERROR_C2) while releasing HREADYOUT in the second cycle."
  },
  {
    requirement: "Burst Transfer Operations",
    rtlModule: "AHB Slave Interface",
    testcase: "TC012",
    details: "Maintains optimal throughput by executing continuous back-to-back address-to-data transfers without injecting idle cycles."
  },
  {
    requirement: "Write Byte Strobe Decode",
    rtlModule: "AHB Slave Interface",
    testcase: "TC010",
    details: "Decodes 32-bit HWDATA and active PSTRB combinations using sizing bits (HSIZE) and alignment variables (HADDR[1:0])."
  },
  {
    requirement: "Asynchronous Reset Initialization",
    rtlModule: "Common",
    testcase: "TC001",
    details: "Ensures that asynchronous assertion of HRESETn yields immediate, glitch-free recovery of FSM to IDLE, resetting PSEL, PENABLE and raising HREADYOUT."
  },
  {
    requirement: "Ignore Idle Transfers",
    rtlModule: "AHB Slave Interface",
    testcase: "TC008",
    details: "Filters HTRANS = IDLE so that no APB activities (PSEL stays low) are triggered on the peripheral side."
  }
];

export const TEST_CASES: TestCase[] = [
  {
    id: "TC001",
    name: "Reset Initialization",
    objective: "Verify asynchronous reset functionality under active bus conditions",
    rtlFeature: "Asynchronous Reset & Power-On State",
    expectedBehaviour: "Upon active-low HRESETn, FSM transitions immediately to IDLE. PSEL and PENABLE must be driven to 0. HREADYOUT must be asserted high within 1 cycle to release any stuck bus.",
    observedBehaviour: "Clean asynchronous assertion. FSM cleared instantly from arbitrary active states back to IDLE. All APB4 control signals tristated/lowered. HREADYOUT released successfully.",
    status: "PASS",
    specMapping: "REQ_INT_001",
    engineerObservation: "Asynchronous reset behavior operates within spec. Gate-level simulation shows zero hazard glitches during asynchronous reset assertion.",
    signals: {
      HCLK:      ["0", "1", "0", "1", "0", "1", "0", "1", "0", "1"],
      HRESETn:   ["0", "0", "1", "1", "1", "1", "1", "1", "1", "1"],
      HTRANS:    ["IDLE", "IDLE", "NONSEQ", "SEQ", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE"],
      HWRITE:    ["0", "0", "1", "1", "0", "0", "0", "0", "0", "0"],
      HADDR:     ["0000", "0000", "1000", "1004", "0000", "0000", "0000", "0000", "0000", "0000"],
      HWDATA:    ["0000", "0000", "0000", "AAAA", "BBBB", "0000", "0000", "0000", "0000", "0000"],
      HREADYOUT: ["1", "1", "1", "0", "0", "1", "1", "1", "1", "1"],
      HRESP:     ["OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK"],
      PSEL:      ["0", "0", "0", "1", "1", "0", "0", "0", "0", "0"],
      PENABLE:   ["0", "0", "0", "0", "1", "0", "0", "0", "0", "0"],
      PREADY:    ["1", "1", "1", "1", "1", "1", "1", "1", "1", "1"]
    }
  },
  {
    id: "TC002",
    name: "Single Write",
    objective: "Verify a single AHB write transaction translates correctly to a 2-cycle APB4 write transaction",
    rtlFeature: "AHB-to-APB4 Write Cycle Translation",
    expectedBehaviour: "A standard write at address 0x1000 with data 0xAAAA5555 triggers standard PSEL high (SETUP phase) and PENABLE high (ENABLE phase). HREADYOUT held low during setup.",
    observedBehaviour: "Detected address phase. Transitioned to SETUP cycle on PSEL. Successfully latched write data in HWDATA register. Asserted PENABLE in cycle 2. HREADYOUT asserted in ENABLE phase.",
    status: "PASS",
    specMapping: "REQ_WR_001",
    engineerObservation: "The write buffer stores HWDATA cleanly. Write timing matches the APB4 specification exactly with zero wait-state overhead.",
    signals: {
      HCLK:      ["0", "1", "0", "1", "0", "1", "0", "1", "0", "1"],
      HRESETn:   ["1", "1", "1", "1", "1", "1", "1", "1", "1", "1"],
      HTRANS:    ["IDLE", "NONSEQ", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE"],
      HWRITE:    ["0", "1", "0", "0", "0", "0", "0", "0", "0", "0"],
      HADDR:     ["0000", "1000", "0000", "0000", "0000", "0000", "0000", "0000", "0000", "0000"],
      HWDATA:    ["0000", "0000", "A5A5", "0000", "0000", "0000", "0000", "0000", "0000", "0000"],
      HREADYOUT: ["1", "1", "0", "1", "1", "1", "1", "1", "1", "1"],
      HRESP:     ["OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK"],
      PSEL:      ["0", "0", "1", "1", "0", "0", "0", "0", "0", "0"],
      PENABLE:   ["0", "0", "0", "1", "0", "0", "0", "0", "0", "0"],
      PREADY:    ["1", "1", "1", "1", "1", "1", "1", "1", "1", "1"]
    }
  },
  {
    id: "TC003",
    name: "Single Read",
    objective: "Verify read data propagation from APB4 PRDATA directly back to AHB HRDATA",
    rtlFeature: "AHB-to-APB4 Read Cycle Translation",
    expectedBehaviour: "A single read transaction drives HRDATA with the value returned by PRDATA during the ENABLE phase. HREADYOUT stays low during setup, goes high during enable.",
    observedBehaviour: "The peripheral asserts PREADY and loads 0xAAAA5555 on PRDATA. The bridge propagates this value to HRDATA. HREADYOUT goes high in cycle 4 releasing the bus master.",
    status: "PASS",
    specMapping: "REQ_RD_001",
    engineerObservation: "No registered delay is observed in read data path. HRDATA is driven combinationally from PRDATA during the access phase, matching target specs.",
    signals: {
      HCLK:      ["0", "1", "0", "1", "0", "1", "0", "1", "0", "1"],
      HRESETn:   ["1", "1", "1", "1", "1", "1", "1", "1", "1", "1"],
      HTRANS:    ["IDLE", "NONSEQ", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE"],
      HWRITE:    ["0", "0", "0", "0", "0", "0", "0", "0", "0", "0"],
      HADDR:     ["0000", "2000", "0000", "0000", "0000", "0000", "0000", "0000", "0000", "0000"],
      HWDATA:    ["0000", "0000", "0000", "0000", "0000", "0000", "0000", "0000", "0000", "0000"],
      HREADYOUT: ["1", "1", "0", "1", "1", "1", "1", "1", "1", "1"],
      HRESP:     ["OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK"],
      PSEL:      ["0", "0", "1", "1", "0", "0", "0", "0", "0", "0"],
      PENABLE:   ["0", "0", "0", "1", "0", "0", "0", "0", "0", "0"],
      PREADY:    ["1", "1", "1", "1", "1", "1", "1", "1", "1", "1"]
    }
  },
  {
    id: "TC004",
    name: "Back-to-Back Write",
    objective: "Verify that multiple sequential writes execute back-to-back without generating idle cycles",
    rtlFeature: "Pipeline back-to-back throughput",
    expectedBehaviour: "Continuous PSEL high during the sequence. SETUP phase of second transfer overlaps with the ENABLE/Access phase of the first transfer.",
    observedBehaviour: "The FSM remains active, overlapping state transitions. Write 1 completes at cycle 3, write 2 begins setup at same cycle. HWDATA buffered in dual internal register cells.",
    status: "PASS",
    specMapping: "REQ_PERF_001",
    engineerObservation: "Maximum bandwidth reached: 2 writes in 4 clock cycles, proving the pipeline controller logic avoids intermediate idle cycles.",
    signals: {
      HCLK:      ["0", "1", "0", "1", "0", "1", "0", "1", "0", "1"],
      HRESETn:   ["1", "1", "1", "1", "1", "1", "1", "1", "1", "1"],
      HTRANS:    ["IDLE", "NONSEQ", "SEQ", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE"],
      HWRITE:    ["0", "1", "1", "0", "0", "0", "0", "0", "0", "0"],
      HADDR:     ["0000", "1001", "1002", "0000", "0000", "0000", "0000", "0000", "0000", "0000"],
      HWDATA:    ["0000", "0000", "1111", "2222", "0000", "0000", "0000", "0000", "0000", "0000"],
      HREADYOUT: ["1", "1", "0", "0", "1", "1", "1", "1", "1", "1"],
      HRESP:     ["OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK"],
      PSEL:      ["0", "0", "1", "1", "1", "1", "0", "0", "0", "0"],
      PENABLE:   ["0", "0", "0", "1", "0", "1", "0", "0", "0", "0"],
      PREADY:    ["1", "1", "1", "1", "1", "1", "1", "1", "1", "1"]
    }
  },
  {
    id: "TC005",
    name: "Back-to-Back Read",
    objective: "Verify continuous sequence of read operations without dead bus states",
    rtlFeature: "Sequential Read Pipeline Optimization",
    expectedBehaviour: "Overlapped read phases on AHB and sequential access on APB. HRDATA contains correct target memories in consecutive cycles.",
    observedBehaviour: "Read 1 completes, propagating PRDATA = 0x11112222. Read 2 completes in immediate next clock cycle, propagating PRDATA = 0x33334444. Zero wait states inserted.",
    status: "PASS",
    specMapping: "REQ_PERF_002",
    engineerObservation: "The pipeline controller resolves read hazards safely. Internal bus isolation verifies that write register values do not leak into read data paths.",
    signals: {
      HCLK:      ["0", "1", "0", "1", "0", "1", "0", "1", "0", "1"],
      HRESETn:   ["1", "1", "1", "1", "1", "1", "1", "1", "1", "1"],
      HTRANS:    ["IDLE", "NONSEQ", "SEQ", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE"],
      HWRITE:    ["0", "0", "0", "0", "0", "0", "0", "0", "0", "0"],
      HADDR:     ["0000", "2001", "2002", "0000", "0000", "0000", "0000", "0000", "0000", "0000"],
      HWDATA:    ["0000", "0000", "0000", "0000", "0000", "0000", "0000", "0000", "0000", "0000"],
      HREADYOUT: ["1", "1", "0", "0", "1", "1", "1", "1", "1", "1"],
      HRESP:     ["OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK"],
      PSEL:      ["0", "0", "1", "1", "1", "1", "0", "0", "0", "0"],
      PENABLE:   ["0", "0", "0", "1", "0", "1", "0", "0", "0", "0"],
      PREADY:    ["1", "1", "1", "1", "1", "1", "1", "1", "1", "1"]
    }
  },
  {
    id: "TC006",
    name: "APB Write Wait States",
    objective: "Verify write stalls driven by the APB target peripheral PREADY de-assertion",
    rtlFeature: "APB Wait-State Propagation",
    expectedBehaviour: "If PREADY is low during APB ENABLE, the FSM transitions to WAIT_ST, stalls AHB (HREADYOUT = 0), and maintains active state until PREADY rises.",
    observedBehaviour: "PREADY driven low for 3 cycles. The FSM remains locked in ENABLE/WAIT_ST, keeping PSEL/PENABLE high and HREADYOUT stalled. AHB write successfully committed when PREADY releases high.",
    status: "PASS",
    specMapping: "REQ_STALL_001",
    engineerObservation: "HREADYOUT mirrors PREADY status correctly, preventing the AHB master from executing subsequent commands during slow APB cycles.",
    signals: {
      HCLK:      ["0", "1", "0", "1", "0", "1", "0", "1", "0", "1"],
      HRESETn:   ["1", "1", "1", "1", "1", "1", "1", "1", "1", "1"],
      HTRANS:    ["IDLE", "NONSEQ", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE"],
      HWRITE:    ["0", "1", "0", "0", "0", "0", "0", "0", "0", "0"],
      HADDR:     ["0000", "1000", "0000", "0000", "0000", "0000", "0000", "0000", "0000", "0000"],
      HWDATA:    ["0000", "0000", "DEBA", "0000", "0000", "0000", "0000", "0000", "0000", "0000"],
      HREADYOUT: ["1", "1", "0", "0", "0", "0", "1", "1", "1", "1"],
      HRESP:     ["OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK"],
      PSEL:      ["0", "0", "1", "1", "1", "1", "1", "0", "0", "0"],
      PENABLE:   ["0", "0", "0", "1", "1", "1", "1", "0", "0", "0"],
      PREADY:    ["1", "1", "1", "0", "0", "0", "1", "1", "1", "1"]
    }
  },
  {
    id: "TC007",
    name: "APB Read Wait States",
    objective: "Verify read stalls and correct read-data propagation under active PREADY wait states",
    rtlFeature: "APB Read Wait-State Propagation",
    expectedBehaviour: "The bridge stalls the read cycle by asserting HREADYOUT low as long as PREADY is low. The read data is only sampled when PREADY is high.",
    observedBehaviour: "FSM transitions to WAIT_ST state. Data DEADBEEF appears on PRDATA in the final wait cycle and is cleanly propagated to HRDATA. HREADYOUT is de-asserted until completion.",
    status: "PASS",
    specMapping: "REQ_STALL_002",
    engineerObservation: "Checked timing paths: Setup time to HRDATA is satisfied on the cycle PREADY is asserted high, which complies with normal synchronous operation.",
    signals: {
      HCLK:      ["0", "1", "0", "1", "0", "1", "0", "1", "0", "1"],
      HRESETn:   ["1", "1", "1", "1", "1", "1", "1", "1", "1", "1"],
      HTRANS:    ["IDLE", "NONSEQ", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE"],
      HWRITE:    ["0", "0", "0", "0", "0", "0", "0", "0", "0", "0"],
      HADDR:     ["0000", "2000", "0000", "0000", "0000", "0000", "0000", "0000", "0000", "0000"],
      HWDATA:    ["0000", "0000", "0000", "0000", "0000", "0000", "0000", "0000", "0000", "0000"],
      HREADYOUT: ["1", "1", "0", "0", "0", "0", "1", "1", "1", "1"],
      HRESP:     ["OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK"],
      PSEL:      ["0", "0", "1", "1", "1", "1", "1", "0", "0", "0"],
      PENABLE:   ["0", "0", "0", "1", "1", "1", "1", "0", "0", "0"],
      PREADY:    ["1", "1", "1", "0", "0", "0", "1", "1", "1", "1"]
    }
  },
  {
    id: "TC008",
    name: "Ignore HTRANS IDLE",
    objective: "Verify that HTRANS = IDLE does not initiate any APB4 transfer states",
    rtlFeature: "Transaction Idle Filtering",
    expectedBehaviour: "The bridge must filter out HTRANS = IDLE transfers. No APB4 PSEL signal should go active, and PENABLE should stay low.",
    observedBehaviour: "HTRANS driven to IDLE during active cycles. Bridge state remains in IDLE, and PSEL/PENABLE are held at 0. HREADYOUT stays high.",
    status: "PASS",
    specMapping: "REQ_FILT_001",
    engineerObservation: "Correct protocol compliance. Idle cycles on AHB-Lite are filtered cleanly with zero dynamic toggles on the APB interface.",
    signals: {
      HCLK:      ["0", "1", "0", "1", "0", "1", "0", "1", "0", "1"],
      HRESETn:   ["1", "1", "1", "1", "1", "1", "1", "1", "1", "1"],
      HTRANS:    ["IDLE", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE"],
      HWRITE:    ["0", "0", "0", "0", "0", "0", "0", "0", "0", "0"],
      HADDR:     ["0000", "0000", "0000", "0000", "0000", "0000", "0000", "0000", "0000", "0000"],
      HWDATA:    ["0000", "0000", "0000", "0000", "0000", "0000", "0000", "0000", "0000", "0000"],
      HREADYOUT: ["1", "1", "1", "1", "1", "1", "1", "1", "1", "1"],
      HRESP:     ["OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK"],
      PSEL:      ["0", "0", "0", "0", "0", "0", "0", "0", "0", "0"],
      PENABLE:   ["0", "0", "0", "0", "0", "0", "0", "0", "0", "0"],
      PREADY:    ["1", "1", "1", "1", "1", "1", "1", "1", "1", "1"]
    }
  },
  {
    id: "TC009",
    name: "Ignore HTRANS BUSY",
    objective: "Verify that HTRANS = BUSY does not trigger APB4 peripheral transfers",
    rtlFeature: "Transaction Busy Filtering",
    expectedBehaviour: "The bridge must treat HTRANS = BUSY as a wait-state or no-operation cycle, leaving APB inactive and maintaining current states.",
    observedBehaviour: "HTRANS driven with BUSY parameters. FSM controller logic remains locked in current state. No new PSEL/PENABLE signals are generated.",
    status: "PASS",
    specMapping: "REQ_FILT_002",
    engineerObservation: "AHB specification requires the bridge to ignore BUSY cycles. RTL correctly processes BUSY transitions without corrupting state data.",
    signals: {
      HCLK:      ["0", "1", "0", "1", "0", "1", "0", "1", "0", "1"],
      HRESETn:   ["1", "1", "1", "1", "1", "1", "1", "1", "1", "1"],
      HTRANS:    ["IDLE", "BUSY", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE"],
      HWRITE:    ["0", "0", "0", "0", "0", "0", "0", "0", "0", "0"],
      HADDR:     ["0000", "0000", "0000", "0000", "0000", "0000", "0000", "0000", "0000", "0000"],
      HWDATA:    ["0000", "0000", "0000", "0000", "0000", "0000", "0000", "0000", "0000", "0000"],
      HREADYOUT: ["1", "1", "1", "1", "1", "1", "1", "1", "1", "1"],
      HRESP:     ["OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK"],
      PSEL:      ["0", "0", "0", "0", "0", "0", "0", "0", "0", "0"],
      PENABLE:   ["0", "0", "0", "0", "0", "0", "0", "0", "0", "0"],
      PREADY:    ["1", "1", "1", "1", "1", "1", "1", "1", "1", "1"]
    }
  },
  {
    id: "TC010",
    name: "PSTRB Decode",
    objective: "Verify active-byte lanes mapped correctly using size (HSIZE) and alignment parameters",
    rtlFeature: "Write Strobe (PSTRB) Decoder",
    expectedBehaviour: "For 32-bit APB4 access, HSIZE of byte (8-bit) at alignment HADDR[1:0] = 2'b00 must map to PSTRB = 4'b0001. HSIZE of halfword (16-bit) at HADDR[1:0] = 2'b10 must map to PSTRB = 4'b1100.",
    observedBehaviour: "Byte access to address 0x1000 successfully driven with PSTRB = 4'b0001. Halfword write at address 0x1002 driven with PSTRB = 4'b1100. Target memory updated cleanly.",
    status: "PASS",
    specMapping: "REQ_STRB_001",
    engineerObservation: "PSTRB decoding logic is completely free of any priority-encoder bottlenecks, minimizing overall delay to less than 120ps in typical 5nm nodes.",
    signals: {
      HCLK:      ["0", "1", "0", "1", "0", "1", "0", "1", "0", "1"],
      HRESETn:   ["1", "1", "1", "1", "1", "1", "1", "1", "1", "1"],
      HTRANS:    ["IDLE", "NONSEQ", "SEQ", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE"],
      HWRITE:    ["0", "1", "1", "0", "0", "0", "0", "0", "0", "0"],
      HADDR:     ["0000", "1000", "1002", "0000", "0000", "0000", "0000", "0000", "0000", "0000"],
      HWDATA:    ["0000", "0000", "00DD", "AABB", "0000", "0000", "0000", "0000", "0000", "0000"],
      HREADYOUT: ["1", "1", "0", "0", "1", "1", "1", "1", "1", "1"],
      HRESP:     ["OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK"],
      PSEL:      ["0", "0", "1", "1", "1", "1", "0", "0", "0", "0"],
      PENABLE:   ["0", "0", "0", "1", "0", "1", "0", "0", "0", "0"],
      PREADY:    ["1", "1", "1", "1", "1", "1", "1", "1", "1", "1"]
    }
  },
  {
    id: "TC011",
    name: "Error Response",
    objective: "Verify that target peripheral PSLVERR asserts standard 2-cycle HRESP = ERROR sequence",
    rtlFeature: "AHB-Lite 2-Cycle Error Translation",
    expectedBehaviour: "If APB peripheral drives PSLVERR=1 during ENABLE phase, the bridge must drive HRESP=ERROR for exactly 2 cycles while keeping HREADYOUT=0 in cycle 1, then releasing HREADYOUT=1 in cycle 2.",
    observedBehaviour: "PSLVERR detected high at cycle 4. FSM transition sequence: ERROR_C1 (cycle 4, HRESP=1, HREADYOUT=0) to ERROR_C2 (cycle 5, HRESP=1, HREADYOUT=1). Correct protocol assertion.",
    status: "PASS",
    specMapping: "REQ_ERR_001",
    engineerObservation: "Perfect alignment to ARM AHB-Lite specification. The 2-cycle protocol correctly aborts the transaction, preventing subsequent data phase contamination.",
    signals: {
      HCLK:      ["0", "1", "0", "1", "0", "1", "0", "1", "0", "1"],
      HRESETn:   ["1", "1", "1", "1", "1", "1", "1", "1", "1", "1"],
      HTRANS:    ["IDLE", "NONSEQ", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE"],
      HWRITE:    ["0", "0", "0", "0", "0", "0", "0", "0", "0", "0"],
      HADDR:     ["0000", "5000", "0000", "0000", "0000", "0000", "0000", "0000", "0000", "0000"],
      HWDATA:    ["0000", "0000", "0000", "0000", "0000", "0000", "0000", "0000", "0000", "0000"],
      HREADYOUT: ["1", "1", "0", "0", "1", "1", "1", "1", "1", "1"],
      HRESP:     ["OK", "OK", "OK", "ERR", "ERR", "OK", "OK", "OK", "OK", "OK"],
      PSEL:      ["0", "0", "1", "1", "0", "0", "0", "0", "0", "0"],
      PENABLE:   ["0", "0", "0", "1", "0", "0", "0", "0", "0", "0"],
      PREADY:    ["1", "1", "1", "1", "1", "1", "1", "1", "1", "1"]
    }
  },
  {
    id: "TC012",
    name: "Burst INCR4",
    objective: "Verify multi-beat incremental burst (INCR4) writes map continuously to consecutive APB cycles",
    rtlFeature: "AHB Incremental Burst Handling",
    expectedBehaviour: "Continuous stream of 4 data beats mapped with zero intermediate idle cycles on APB4.",
    observedBehaviour: "Four successive writes executed. Beat1=0xB0000000, Beat2=0xB1111111, Beat3=0xB2222222, Beat4=0xB3333333 loaded in pipeline. PSEL held high for 8 continuous cycles.",
    status: "PASS",
    specMapping: "REQ_BURST_001",
    engineerObservation: "No bubbles are inserted in the APB output. The address generator auto-increments the target boundary offsets perfectly.",
    signals: {
      HCLK:      ["0", "1", "0", "1", "0", "1", "0", "1", "0", "1"],
      HRESETn:   ["1", "1", "1", "1", "1", "1", "1", "1", "1", "1"],
      HTRANS:    ["IDLE", "NONSEQ", "SEQ", "SEQ", "SEQ", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE"],
      HWRITE:    ["0", "1", "1", "1", "1", "0", "0", "0", "0", "0"],
      HADDR:     ["0000", "3000", "3004", "3008", "300C", "0000", "0000", "0000", "0000", "0000"],
      HWDATA:    ["0000", "0000", "B000", "B111", "B222", "B333", "0000", "0000", "0000", "0000"],
      HREADYOUT: ["1", "1", "0", "0", "0", "0", "1", "1", "1", "1"],
      HRESP:     ["OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK"],
      PSEL:      ["0", "0", "1", "1", "1", "1", "1", "1", "0", "0"],
      PENABLE:   ["0", "0", "0", "1", "0", "1", "0", "1", "0", "0"],
      PREADY:    ["1", "1", "1", "1", "1", "1", "1", "1", "1", "1"]
    }
  },
  {
    id: "TC013",
    name: "Reset During Wait State",
    objective: "Verify that asserting reset during a long wait-state stall causes a clean exit and instant bus recovery",
    rtlFeature: "Reset-Stall Abort Logic",
    expectedBehaviour: "Asserting HRESETn low while the peripheral holds PREADY low must immediately clear the FSM, release PSEL/PENABLE, and assert HREADYOUT.",
    observedBehaviour: "PREADY held low to force active WAIT_ST. Resets asserted at cycle 4. FSM immediately exited to IDLE, all control lines fell to 0, HREADYOUT went high in cycle 5.",
    status: "PASS",
    specMapping: "REQ_INT_002",
    engineerObservation: "Protects against deadlocked slaves. If a peripheral becomes unresponsive (stalling PREADY), a system reset guarantees clean, immediate bus release.",
    signals: {
      HCLK:      ["0", "1", "0", "1", "0", "1", "0", "1", "0", "1"],
      HRESETn:   ["1", "1", "1", "1", "0", "0", "1", "1", "1", "1"],
      HTRANS:    ["IDLE", "NONSEQ", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE"],
      HWRITE:    ["0", "1", "0", "0", "0", "0", "0", "0", "0", "0"],
      HADDR:     ["0000", "1000", "0000", "0000", "0000", "0000", "0000", "0000", "0000", "0000"],
      HWDATA:    ["0000", "0000", "A5A5", "0000", "0000", "0000", "0000", "0000", "0000", "0000"],
      HREADYOUT: ["1", "1", "0", "0", "1", "1", "1", "1", "1", "1"],
      HRESP:     ["OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK"],
      PSEL:      ["0", "0", "1", "1", "0", "0", "0", "0", "0", "0"],
      PENABLE:   ["0", "0", "0", "1", "0", "0", "0", "0", "0", "0"],
      PREADY:    ["1", "1", "1", "0", "0", "0", "1", "1", "1", "1"]
    }
  },
  {
    id: "TC014",
    name: "Random Stress",
    objective: "Run random read/write transactions with randomized wait states and size alignments to test boundary states",
    rtlFeature: "Comprehensive Protocol Stress Coverage",
    expectedBehaviour: "Perfect adherence to protocol specs over 100 continuous iterations of mixed commands. Zero deadlocks or data corruption.",
    observedBehaviour: "Completed 100 random iterations (forming part of the full 215 regression suite). Checked self-verifying testbench scoreboard. Zero mismatch reports.",
    status: "PASS",
    specMapping: "REQ_COV_001",
    engineerObservation: "Completed full randomized regression without error. Scoreboard verified 100% address alignment and write-data matching accuracy.",
    signals: {
      HCLK:      ["0", "1", "0", "1", "0", "1", "0", "1", "0", "1"],
      HRESETn:   ["1", "1", "1", "1", "1", "1", "1", "1", "1", "1"],
      HTRANS:    ["IDLE", "NONSEQ", "SEQ", "IDLE", "NONSEQ", "IDLE", "IDLE", "IDLE", "IDLE", "IDLE"],
      HWRITE:    ["0", "1", "1", "0", "0", "0", "0", "0", "0", "0"],
      HADDR:     ["0000", "1000", "1004", "0000", "2000", "0000", "0000", "0000", "0000", "0000"],
      HWDATA:    ["0000", "0000", "FFAA", "FF55", "0000", "0000", "0000", "0000", "0000", "0000"],
      HREADYOUT: ["1", "1", "0", "0", "1", "0", "1", "1", "1", "1"],
      HRESP:     ["OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK", "OK"],
      PSEL:      ["0", "0", "1", "1", "1", "1", "1", "0", "0", "0"],
      PENABLE:   ["0", "0", "0", "1", "0", "1", "1", "0", "0", "0"],
      PREADY:    ["1", "1", "1", "1", "1", "1", "1", "1", "1", "1"]
    }
  }
];

export const CONSOLE_OUTPUT = `[INFO] Initializing VCS Simulator vS-2025.09-SP1-3...
[INFO] Loading RTL design files...
       - /rtl/ahb_lite_slave_interface.v (parsed)
       - /rtl/apb4_master_interface.v (parsed)
       - /rtl/bridge_fsm_controller.v (parsed)
       - /rtl/ahb_to_apb_bridge_top.v (parsed)
[INFO] Loading Testbench verification files...
       - /tb/tb_ahb_to_apb_bridge.sv (parsed)
       - /tb/scoreboard.sv (parsed)
       - /tb/assertion_monitor.sv (parsed)
[INFO] Elaborating design with strict-lint checks...
[LINT] 0 Warnings, 0 Errors.
[INFO] Running test suite...
[0.00 ns] HRESETn asserted. Simulating system start...
[10.00 ns] TC001 Reset Initialization - STARTING
[30.00 ns] TC001 Reset Initialization - [PASS]
[50.00 ns] TC002 Single Write Transaction - STARTING
[80.00 ns] TC002 Single Write Transaction - [PASS]
[100.00 ns] TC003 Single Read Transaction - STARTING
[130.00 ns] TC003 Single Read Transaction - [PASS]
[150.00 ns] TC004 Back-to-Back Sequential Write - STARTING
[190.00 ns] TC004 Back-to-Back Sequential Write - [PASS]
[210.00 ns] TC005 Back-to-Back Sequential Read - STARTING
[250.00 ns] TC005 Back-to-Back Sequential Read - [PASS]
[270.00 ns] TC006 APB Wait State Inject (Write) - STARTING
[320.00 ns] TC006 APB Wait State Inject (Write) - [PASS] (PREADY held low for 3 cycles)
[340.00 ns] TC007 APB Wait State Inject (Read) - STARTING
[390.00 ns] TC007 APB Wait State Inject (Read) - [PASS]
[410.00 ns] TC008 Ignore HTRANS IDLE Cycles - STARTING
[430.00 ns] TC008 Ignore HTRANS IDLE Cycles - [PASS]
[450.00 ns] TC009 Ignore HTRANS BUSY Cycles - STARTING
[470.00 ns] TC009 Ignore HTRANS BUSY Cycles - [PASS]
[490.00 ns] TC010 PSTRB Byte/Halfword Decode Validation - STARTING
[530.00 ns] TC010 PSTRB Byte/Halfword Decode Validation - [PASS]
[550.00 ns] TC011 Error Response Flow (PSLVERR Assertion) - STARTING
[580.00 ns] TC011 Error Response Flow (PSLVERR Assertion) - [PASS] (HRESP error sequence matched)
[600.00 ns] TC012 Burst Transfer (INCR4 Incremental beats) - STARTING
[660.00 ns] TC012 Burst Transfer (INCR4 Incremental beats) - [PASS]
[680.00 ns] TC013 Reset Assertion During Wait State Stall - STARTING
[710.00 ns] TC013 Reset Assertion During Wait State Stall - [PASS]
[730.00 ns] TC014 Random Stress Tests (100 Iterations) - STARTING
[1840.00 ns] TC014 Random Stress Tests (100 Iterations) - [PASS]
[1850.00 ns] [SUCCESS] All 14 directed testcases executed successfully.
[1850.00 ns] Scoreboard Report:
             - Matches: 1475 transactions
             - Mismatches: 0
             - Protocol Violations: 0
[1850.00 ns] Assertion Summary:
             - ast_hready_stalled: triggered 21 times, 0 failures
             - ast_penable_timing: triggered 215 times, 0 failures
             - ast_pwrite_stable: triggered 112 times, 0 failures
             - ast_hresp_duration: triggered 5 times, 0 failures
[1850.00 ns] Coverage metrics extracted successfully:
             - Line Coverage: 100%
             - Toggle Coverage: 98.7%
             - FSM State Coverage: 100% (All 6 states visited)
             - FSM Transition Coverage: 100% (All 15 transitions covered)
             - Assertion Coverage: 100%
[1850.00 ns] -------------------------------------------------------------
[1850.00 ns] REGRESSION RESULTS : 215/215 TESTS PASSED
[1850.00 ns] CRITICAL ERRORS    : 0
[1850.00 ns] RESULT             : 100% SPECIFICATION SIGN-OFF PASSED
[1850.00 ns] -------------------------------------------------------------
`;
