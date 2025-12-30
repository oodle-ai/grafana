// Comprehensive validation function for math expressions
// This closely matches the backend parser implementation from pkg/expr/mathexp/parse/

interface Token {
  type: string;
  value: string;
}

export const validateMathExpression = (
  expression: string,
  availableQueries?: Array<{ refId: string }>
): string | null => {
  if (!expression || expression.trim() === '') {
    return null; // Empty expressions are valid (will be handled by backend)
  }

  const trimmed = expression.trim();

  // Built-in functions from pkg/expr/mathexp/funcs.go
  const builtinFunctions = new Set([
    'abs',
    'log',
    'nan',
    'is_nan',
    'inf',
    'infn',
    'is_inf',
    'null',
    'is_null',
    'is_number',
    'round',
    'ceil',
    'floor',
  ]);

  // Create set of available query refIds for variable validation
  const availableRefIds = new Set(availableQueries?.map((q) => q.refId) || []);

  // Tokenize the expression similar to the lexer
  const tokens = tokenizeExpression(trimmed);
  if (typeof tokens === 'string') {
    return tokens; // Return error message from tokenization
  }

  // Validate token sequence according to grammar
  return validateTokenSequence(tokens, builtinFunctions, availableRefIds);

  // Tokenization function based on lex.go
  function tokenizeExpression(input: string): string | Token[] {
    const tokens: Token[] = [];
    let pos = 0;

    while (pos < input.length) {
      const char = input[pos];

      // Skip whitespace
      if (/\s/.test(char)) {
        pos++;
        continue;
      }

      // Handle variables ($A or ${var})
      if (char === '$') {
        const varResult = parseVariable(input, pos);
        if (typeof varResult === 'string') {
          return varResult; // Error
        }
        tokens.push(varResult.token);
        pos = varResult.nextPos;
        continue;
      }

      // Handle strings
      if (char === '"') {
        const strResult = parseString(input, pos);
        if (typeof strResult === 'string') {
          return strResult; // Error
        }
        tokens.push(strResult.token);
        pos = strResult.nextPos;
        continue;
      }

      // Handle numbers
      if (/\d/.test(char) || char === '.') {
        const numResult = parseNumber(input, pos);
        if (typeof numResult === 'string') {
          return numResult; // Error
        }
        tokens.push(numResult.token);
        pos = numResult.nextPos;
        continue;
      }

      // Handle functions (letters and underscores)
      if (/[a-zA-Z_]/.test(char)) {
        const funcResult = parseFunction(input, pos);
        tokens.push(funcResult.token);
        pos = funcResult.nextPos;
        continue;
      }

      // Handle symbols and operators
      if (/[!<>=&|+\-*/%()]/.test(char)) {
        const symbolResult = parseSymbol(input, pos);
        if (typeof symbolResult === 'string') {
          return symbolResult; // Error
        }
        tokens.push(symbolResult.token);
        pos = symbolResult.nextPos;
        continue;
      }

      // Invalid character
      return `Invalid character: ${char}`;
    }

    return tokens;
  }

  function parseVariable(input: string, start: number): string | { token: Token; nextPos: number } {
    let pos = start + 1; // Skip $

    if (input[pos] === '{') {
      // ${var} format
      pos++;
      let hasChar = false;
      while (pos < input.length) {
        const char = input[pos];
        if (char === '}') {
          if (!hasChar) {
            return 'Incomplete variable';
          }
          return {
            token: { type: 'var', value: input.slice(start, pos + 1) },
            nextPos: pos + 1,
          };
        }
        if (char === '\n' || char === '\r') {
          return 'Unterminated variable missing closing }';
        }
        if (/[a-zA-Z0-9_\s]/.test(char)) {
          hasChar = true;
        } else if (char === '+' || char === '-' || char === '*' || char === '/' || char === '(' || char === ')') {
          // These characters indicate the variable is incomplete
          return 'Unterminated variable missing closing }';
        } else {
          return 'Unsupported variable character';
        }
        pos++;
      }
      return 'Unterminated variable missing closing }';
    } else {
      // $A format
      let hasChar = false;
      while (pos < input.length && /[a-zA-Z0-9_]/.test(input[pos])) {
        hasChar = true;
        pos++;
      }
      if (!hasChar) {
        return 'Incomplete variable';
      }
      return {
        token: { type: 'var', value: input.slice(start, pos) },
        nextPos: pos,
      };
    }
  }

  function parseString(input: string, start: number): string | { token: Token; nextPos: number } {
    let pos = start + 1; // Skip opening quote
    while (pos < input.length) {
      if (input[pos] === '"') {
        return {
          token: { type: 'string', value: input.slice(start, pos + 1) },
          nextPos: pos + 1,
        };
      }
      pos++;
    }
    return 'Unterminated string';
  }

  function parseNumber(input: string, start: number): string | { token: Token; nextPos: number } {
    let pos = start;

    // Handle hex numbers (0x...)
    if (input[pos] === '0' && pos + 1 < input.length && /[xX]/.test(input[pos + 1])) {
      pos += 2;
      while (pos < input.length && /[0-9a-fA-F]/.test(input[pos])) {
        pos++;
      }
    } else {
      // Handle decimal numbers
      while (pos < input.length && /\d/.test(input[pos])) {
        pos++;
      }

      // Handle decimal point
      if (pos < input.length && input[pos] === '.') {
        pos++;
        while (pos < input.length && /\d/.test(input[pos])) {
          pos++;
        }
      }

      // Handle scientific notation
      if (pos < input.length && /[eE]/.test(input[pos])) {
        pos++;
        if (pos < input.length && /[+-]/.test(input[pos])) {
          pos++;
        }
        while (pos < input.length && /\d/.test(input[pos])) {
          pos++;
        }
      }
    }

    return {
      token: { type: 'number', value: input.slice(start, pos) },
      nextPos: pos,
    };
  }

  function parseFunction(input: string, start: number): { token: Token; nextPos: number } {
    let pos = start;
    while (pos < input.length && /[a-zA-Z0-9_]/.test(input[pos])) {
      pos++;
    }
    return {
      token: { type: 'func', value: input.slice(start, pos) },
      nextPos: pos,
    };
  }

  function parseSymbol(input: string, start: number): string | { token: Token; nextPos: number } {
    let pos = start;
    const char = input[pos];

    // Handle multi-character operators (check these first)
    if (char === '&' && pos + 1 < input.length && input[pos + 1] === '&') {
      return { token: { type: '&&', value: '&&' }, nextPos: pos + 2 };
    }
    if (char === '|' && pos + 1 < input.length && input[pos + 1] === '|') {
      return { token: { type: '||', value: '||' }, nextPos: pos + 2 };
    }
    if (char === '=' && pos + 1 < input.length && input[pos + 1] === '=') {
      return { token: { type: '==', value: '==' }, nextPos: pos + 2 };
    }
    if (char === '!' && pos + 1 < input.length && input[pos + 1] === '=') {
      return { token: { type: '!=', value: '!=' }, nextPos: pos + 2 };
    }
    if (char === '>' && pos + 1 < input.length && input[pos + 1] === '=') {
      return { token: { type: '>=', value: '>=' }, nextPos: pos + 2 };
    }
    if (char === '<' && pos + 1 < input.length && input[pos + 1] === '=') {
      return { token: { type: '<=', value: '<=' }, nextPos: pos + 2 };
    }
    if (char === '*' && pos + 1 < input.length && input[pos + 1] === '*') {
      return { token: { type: '**', value: '**' }, nextPos: pos + 2 };
    }

    // Single character operators
    if (['!', '>', '<', '+', '-', '*', '/', '%', '(', ')'].includes(char)) {
      return { token: { type: char, value: char }, nextPos: pos + 1 };
    }

    return `Invalid operator: ${char}`;
  }

  function validateTokenSequence(
    tokens: Token[],
    builtinFunctions: Set<string>,
    availableRefIds: Set<string>
  ): string | null {
    if (tokens.length === 0) {
      return null;
    }

    // Check for incomplete expressions (ends with operator)
    const lastToken = tokens[tokens.length - 1];
    if (isOperator(lastToken.type)) {
      return 'Expression cannot end with an operator';
    }

    // Check for incomplete expressions (starts with most operators)
    const firstToken = tokens[0];
    if (isOperator(firstToken.type) && !['-', '!'].includes(firstToken.type)) {
      return 'Expression cannot start with this operator';
    }

    // Check for empty function calls
    for (let i = 0; i < tokens.length - 1; i++) {
      if (tokens[i].type === 'func' && tokens[i + 1].type === '(') {
        // Look for matching closing parenthesis
        let parenCount = 1;
        let j = i + 2;
        while (j < tokens.length && parenCount > 0) {
          if (tokens[j].type === '(') {
            parenCount++;
          }
          if (tokens[j].type === ')') {
            parenCount--;
          }
          j++;
        }
        if (parenCount === 0 && j === i + 3) {
          return 'Empty function call is not valid';
        }
      }
    }

    // Validate function names
    for (const token of tokens) {
      if (token.type === 'func' && !builtinFunctions.has(token.value)) {
        return `Unknown function: ${token.value}`;
      }
    }

    // Validate variable references
    for (const token of tokens) {
      if (token.type === 'var') {
        const varName = token.value.startsWith('${')
          ? token.value.slice(2, -1) // Remove ${ and }
          : token.value.slice(1); // Remove $

        if (!availableRefIds.has(varName)) {
          return `Variable ${token.value} does not exist`;
        }
      }
    }

    // Check parentheses balance
    let parenCount = 0;
    for (const token of tokens) {
      if (token.type === '(') {
        parenCount++;
      }
      if (token.type === ')') {
        parenCount--;
      }
      if (parenCount < 0) {
        return 'Unmatched closing parenthesis';
      }
    }
    if (parenCount > 0) {
      return 'Unmatched opening parenthesis';
    }

    // Validate expression structure according to grammar
    return validateExpressionGrammar(tokens);
  }

  function validateExpressionGrammar(tokens: Token[]): string | null {
    // This is a simplified grammar validation
    // The full grammar is: O -> A {"||" A}, A -> C {"&&" C}, etc.

    if (tokens.length === 0) {
      return null;
    }

    // Check for invalid operator sequences
    for (let i = 0; i < tokens.length - 1; i++) {
      const current = tokens[i];
      const next = tokens[i + 1];

      // Consecutive operators (except for unary minus and not)
      if (isOperator(current.type) && isOperator(next.type)) {
        // Allow unary minus and not after operators, at start, or after opening parenthesis
        if (
          !(next.type === '-' && (i === 0 || isOperator(tokens[i - 1].type) || tokens[i - 1].type === '(')) &&
          !(next.type === '!' && (i === 0 || isOperator(tokens[i - 1].type) || tokens[i - 1].type === '('))
        ) {
          return 'Consecutive operators are not valid';
        }
      }
    }

    return null;
  }

  function isOperator(type: string): boolean {
    return ['!', '&&', '||', '>', '<', '>=', '<=', '==', '!=', '+', '-', '*', '/', '%', '**'].includes(type);
  }
};
