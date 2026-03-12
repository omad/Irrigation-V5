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
  const appliedCardMod = [];

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
    static applyToElement(element, type, style) {
      appliedCardMod.push({ element, type, style });
    }
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
    appliedCardMod,
    context,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
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

test("passes card-mod config through to the inner card and applies it safely", async () => {
  const { IrrigationCard, appliedCardMod } = buildEnvironment();
  const card = new IrrigationCard();

  card.setConfig({
    program: "switch.program",
    entities: [],
    show_program: true,
    card: { type: "entities" },
    card_mod: { style: "ha-card { border: none; }" },
  });
  card.hass = {
    states: {
      "switch.program": {
        state: "off",
        attributes: {
          zones: [],
          show_config: "switch.program_config",
          irrigation_on: "switch.program_enabled",
        },
      },
      "switch.program_config": { state: "off", attributes: {} },
      "switch.program_enabled": { state: "on", attributes: {} },
    },
  };

  await flushAsyncWork();

  assert.equal(card._cardElement.config.card_mod.style, "ha-card { border: none; }");
  assert.ok(appliedCardMod.some((entry) => entry.type === "card-mod-card"));
});

test("ignores stale async renders so settings rows can appear after toggle", async () => {
  const helperReady = deferred();
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

  const context = {
    HTMLElement: FakeHTMLElement,
    customElements,
    document: {
      createElement(name) {
        if (name === "hui-entities-card") {
          return new FakeEntitiesCard();
        }
        return new FakeHTMLElement();
      },
    },
    window: {
      customCards: [],
      loadCardHelpers: async () => {
        await helperReady.promise;
        return {
          createCardElement: () => new FakeEntitiesCard(),
        };
      },
    },
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
  const IrrigationCard = customElements.get("irrigation-card");

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
        state: "off",
        attributes: {
          zones: [],
          show_config: "switch.program_config",
          irrigation_on: "switch.program_enabled",
          start_time: "input_datetime.program_start",
        },
      },
      "switch.program_config": { state: "off", attributes: {} },
      "switch.program_enabled": { state: "on", attributes: {} },
      "input_datetime.program_start": { state: "06:00:00", attributes: {} },
    },
  };

  card.hass = {
    states: {
      "switch.program": {
        state: "off",
        attributes: {
          zones: [],
          show_config: "switch.program_config",
          irrigation_on: "switch.program_enabled",
          start_time: "input_datetime.program_start",
        },
      },
      "switch.program_config": { state: "on", attributes: {} },
      "switch.program_enabled": { state: "on", attributes: {} },
      "input_datetime.program_start": { state: "06:00:00", attributes: {} },
    },
  };

  helperReady.resolve();
  await flushAsyncWork();

  const conditionalRows = card._cardElement.config.entities.filter((entity) => entity.type === "conditional");
  assert.ok(
    conditionalRows.some(
      (entity) =>
        entity.conditions?.some(
          (condition) => condition.entity === "switch.program_config" && condition.state === "on"
        )
    )
  );
});

test("script tolerates pre-registered elements and existing customCards metadata", () => {
  const registry = new Map();
  registry.set("irrigation-card", FakeEntitiesCard);
  registry.set("irrigation-card-editor", FakeEntitiesCard);
  registry.set("hui-entities-card", FakeEntitiesCard);
  registry.set("card-mod", class {
    static applyToElement() {}
  });

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

  const context = {
    HTMLElement: FakeHTMLElement,
    customElements,
    document: {
      createElement(name) {
        if (name === "hui-entities-card") {
          return new FakeEntitiesCard();
        }
        return new FakeHTMLElement();
      },
    },
    window: {
      customCards: [{ type: "irrigation-card", name: "Irrigation Card" }],
    },
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

  assert.doesNotThrow(() => vm.runInContext(source, context));
  assert.equal(context.window.customCards.filter((card) => card.type === "irrigation-card").length, 1);
});
