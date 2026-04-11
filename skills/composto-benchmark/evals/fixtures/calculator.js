function add(a, b) {
  return a + b;
}

function subtract(a, b) {
  return a - b;
}

function multiply(a, b) {
  return a * b;
}

function divide(a, b) {
  if (b === 0) {
    throw new Error("Division by zero");
  }
  return a / b;
}

function calculate(operation, a, b) {
  switch (operation) {
    case "add":
      return add(a, b);
    case "subtract":
      return subtract(a, b);
    case "multiply":
      return multiply(a, b);
    case "divide":
      return divide(a, b);
    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
}

// Assertions
const assert = (condition, msg) => {
  if (!condition) throw new Error(`FAIL: ${msg}`);
  console.log(`PASS: ${msg}`);
};

// add
assert(add(2, 3) === 5, "2 + 3 = 5");
assert(add(-1, 1) === 0, "-1 + 1 = 0");
assert(add(0, 0) === 0, "0 + 0 = 0");

// subtract
assert(subtract(10, 4) === 6, "10 - 4 = 6");
assert(subtract(0, 5) === -5, "0 - 5 = -5");
assert(subtract(-3, -3) === 0, "-3 - (-3) = 0");

// multiply
assert(multiply(3, 7) === 21, "3 * 7 = 21");
assert(multiply(-2, 4) === -8, "-2 * 4 = -8");
assert(multiply(0, 100) === 0, "0 * 100 = 0");

// divide
assert(divide(10, 2) === 5, "10 / 2 = 5");
assert(divide(7, 2) === 3.5, "7 / 2 = 3.5");
assert(divide(-9, 3) === -3, "-9 / 3 = -3");

// divide by zero
try {
  divide(1, 0);
  assert(false, "divide by zero should throw");
} catch (e) {
  assert(e.message === "Division by zero", "divide by zero throws correct error");
}

// calculate dispatcher
assert(calculate("add", 1, 2) === 3, "calculate('add', 1, 2) = 3");
assert(calculate("subtract", 5, 3) === 2, "calculate('subtract', 5, 3) = 2");
assert(calculate("multiply", 4, 5) === 20, "calculate('multiply', 4, 5) = 20");
assert(calculate("divide", 8, 4) === 2, "calculate('divide', 8, 4) = 2");

try {
  calculate("modulo", 5, 3);
  assert(false, "unknown op should throw");
} catch (e) {
  assert(e.message === "Unknown operation: modulo", "unknown op throws correct error");
}

console.log("\nAll assertions passed.");
