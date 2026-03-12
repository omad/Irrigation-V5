const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const assert = require("node:assert/strict");

class FakeHTMLElement {
  constructor() {
    this.children = [];
    this.shadowRoot = null;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    this.children = this.children.filter((item) => item !== child);
    return child;
  }

  contains(child) {
    return this.children.includes(child);
  }

  attachShadow() {
    this.shadowRoot = {
      append: () => {},
    };
    return this.shadowRoot;
  }
}

class FakeEntitiesCard extends FakeHTMLElement {
  constructor() {
    super();
    this.configs = [];
    this.hass = null;
  }

  setConfig(config) {
    this.configs.push(config);
    this.config = config;
  }

  getCardSize() {
    return 7;
  }
}

function buildEnvironment({ useHelpers = true } = {}) {
  const registry = new Map();

  const customElements = {
    define(name, klass) {
      registry.set(name, klass);
    },
    get(name) {
      return registry.get(name);
    },
    whenDefined(name) {
      if (registry.has(name)) {
        return Promise.resolve();
      }
      return Promise.reject(new Error(`Element not defined: ${name}`));
    },
  };

  registry.set("hui-entities-card", FakeEntitiesCard);
  registry.set("card-mod", class {
    static applyToElement() {}
  });

  const document = {
    createElement(name) {
      if (name === "hui-entities-card") {
        return new FakeEntitiesCard();
      }
      return new FakeHTMLElement();
    },
  };

  const window = {
    customCards: [],
    loadCardHelpers: useHelpers
      ? async () => ({
          createCardElement: () => new FakeEntitiesCard(),
        })
      : undefined,
  };

  const context = {
    HTMLElement: FakeHTMLElement,
    customElements,
    document,
    window,
    console,
    Event,
    Option: class {
      constructor(text, value) {
        this.text = text;
        this.value = value;
        this.selected = false;
      }
    },
  };

  vm.createContext(context);
  const source = fs.readFileSync(
    path.join(__dirname, "..", "custom_components", "irrigationprogram", "www", "irrigation-card.js"),
    "utf8"
  );
  vm.runInContext(source, context);

  return {
    IrrigationCard: customElements.get("irrigation-card"),
  };
}

async function flushAsyncWork() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

test("renders an error card instead of throwing when program state is missing", async () => {
  const { IrrigationCard } = buildEnvironment();
  const card = new IrrigationCard();

  card.setConfig({
    program: "switch.missing_program",
    entities: [],
    show_program: true,
    card: { type: "entities" },
  });
  card.hass = { states: {} };

  await flushAsyncWork();

  assert.equal(card._cardElement.config.entities[0].label, "Program unavailable or not selected");
});

test("renders a loading error when program attributes are not ready yet", async () => {
  const { IrrigationCard } = buildEnvironment();
  const card = new IrrigationCard();

  card.setConfig({
    program: "switch.program",
    entities: [],
    show_program: true,
    card: { type: "entities" },
  });
  card.hass = {
    states: {
      "switch.program": {
        attributes: {},
      },
    },
  };

  await flushAsyncWork();

  assert.equal(
    card._cardElement.config.entities[0].label,
    "Program is still loading its card attributes"
  );
});

test("handles partial zone attribute data without throwing", async () => {
  const { IrrigationCard } = buildEnvironment({ useHelpers: false });
  const card = new IrrigationCard();

  card.setConfig({
    program: "switch.program",
    entities: ["switch.zone_1"],
    show_program: true,
    card: { type: "entities" },
  });
  card.hass = {
    states: {
      "switch.program": {
        state: "off",
        attributes: {
          zones: ["switch.zone_1"],
          irrigation_on: "switch.program_enabled",
          remaining: "sensor.program_remaining",
        },
      },
      "switch.program_enabled": { state: "on", attributes: {} },
      "sensor.program_remaining": { state: "0", attributes: {} },
      "switch.zone_1": {
        state: "off",
        attributes: {},
      },
    },
  };

  await flushAsyncWork();

  assert.ok(Array.isArray(card._cardElement.config.entities));
  assert.equal(card.getCardSize(), 7);
});
