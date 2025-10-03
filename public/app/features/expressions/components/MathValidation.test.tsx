import { validateMathExpression } from './MathValidation';

// Mock the validation function by extracting it
// This is a simple test to verify our validation logic works

describe('Math Expression Validation', () => {
  const mockQueries = [{ refId: 'A' }, { refId: 'B' }, { refId: 'C' }];

  describe('Variable validation', () => {
    it('should validate existing variables', () => {
      expect(validateMathExpression('$A + $B', mockQueries)).toBeNull();
      expect(validateMathExpression('${A} + ${B}', mockQueries)).toBeNull();
    });

    it('should reject non-existent variables', () => {
      expect(validateMathExpression('$D + $B', mockQueries)).toBe('Variable $D does not exist');
      expect(validateMathExpression('${D} + ${B}', mockQueries)).toBe('Variable ${D} does not exist');
    });
  });

  describe('Incomplete expressions', () => {
    it('should reject expressions ending with operators', () => {
      expect(validateMathExpression('$A +', mockQueries)).toBe('Expression cannot end with an operator');
      expect(validateMathExpression('$A *', mockQueries)).toBe('Expression cannot end with an operator');
      expect(validateMathExpression('$A /', mockQueries)).toBe('Expression cannot end with an operator');
    });

    it('should reject expressions starting with most operators', () => {
      expect(validateMathExpression('+ $A', mockQueries)).toBe('Expression cannot start with this operator');
      expect(validateMathExpression('* $A', mockQueries)).toBe('Expression cannot start with this operator');
      expect(validateMathExpression('/ $A', mockQueries)).toBe('Expression cannot start with this operator');
    });

    it('should allow expressions starting with unary minus and not', () => {
      expect(validateMathExpression('- $A', mockQueries)).toBeNull();
      expect(validateMathExpression('! $A', mockQueries)).toBeNull();
    });
  });

  describe('Function validation', () => {
    it('should validate built-in functions', () => {
      expect(validateMathExpression('abs($A)', mockQueries)).toBeNull();
      expect(validateMathExpression('log($A)', mockQueries)).toBeNull();
      expect(validateMathExpression('round($A)', mockQueries)).toBeNull();
    });

    it('should reject unknown functions', () => {
      expect(validateMathExpression('sqrt($A)', mockQueries)).toBe('Unknown function: sqrt');
      expect(validateMathExpression('sin($A)', mockQueries)).toBe('Unknown function: sin');
    });

    it('should reject empty function calls', () => {
      expect(validateMathExpression('abs()', mockQueries)).toBe('Empty function call is not valid');
    });
  });

  describe('Syntax validation', () => {
    it('should validate parentheses balance', () => {
      expect(validateMathExpression('($A + $B)', mockQueries)).toBeNull();
      expect(validateMathExpression('(($A + $B) * $C)', mockQueries)).toBeNull();
    });

    it('should reject unmatched parentheses', () => {
      expect(validateMathExpression('($A + $B', mockQueries)).toBe('Unmatched opening parenthesis');
      expect(validateMathExpression('$A + $B)', mockQueries)).toBe('Unmatched closing parenthesis');
    });

    it('should reject consecutive operators', () => {
      expect(validateMathExpression('$A ++ $B', mockQueries)).toBe('Consecutive operators are not valid');
      expect(validateMathExpression('$A // $B', mockQueries)).toBe('Consecutive operators are not valid');
    });

    it('should allow unary minus in appropriate contexts', () => {
      expect(validateMathExpression('$A + -$B', mockQueries)).toBeNull();
      expect(validateMathExpression('-$A + $B', mockQueries)).toBeNull();
    });
  });

  describe('Number validation', () => {
    it('should validate various number formats', () => {
      expect(validateMathExpression('1 + 2', mockQueries)).toBeNull();
      expect(validateMathExpression('1.5 + 2.7', mockQueries)).toBeNull();
      expect(validateMathExpression('1e3 + 2e-4', mockQueries)).toBeNull();
      expect(validateMathExpression('0x1A + 0xFF', mockQueries)).toBeNull();
    });
  });

  describe('String validation', () => {
    it('should validate string literals', () => {
      expect(validateMathExpression('"hello" + "world"', mockQueries)).toBeNull();
    });

    it('should reject unterminated strings', () => {
      expect(validateMathExpression('"hello', mockQueries)).toBe('Unterminated string');
    });
  });

  describe('Variable format validation', () => {
    it('should validate ${var} format', () => {
      expect(validateMathExpression('${A} + ${B}', mockQueries)).toBeNull();
    });

    it('should reject incomplete ${var} format', () => {
      expect(validateMathExpression('${A + ${B}', mockQueries)).toBe('Unterminated variable missing closing }');
      expect(validateMathExpression('${} + ${B}', mockQueries)).toBe('Incomplete variable');
    });
  });
});
