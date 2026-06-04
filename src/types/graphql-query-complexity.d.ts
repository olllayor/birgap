declare module 'graphql-query-complexity' {
  import type { GraphQLSchema, ValidationContext, ASTVisitor } from 'graphql';

  export type ComplexityEstimatorArgs = {
    args: Record<string, unknown>;
    childComplexity: number;
    field: unknown;
    node: unknown;
    type: unknown;
  };

  export type ComplexityEstimator = (options: ComplexityEstimatorArgs) => number | void;

  export type QueryComplexityOptions = {
    maximumComplexity: number;
    estimators: ComplexityEstimator[];
    variables?: Record<string, unknown>;
    operationName?: string;
    onComplete?: (complexity: number) => void;
    createError?: (max: number, actual: number) => Error;
    context?: Record<string, unknown>;
    maxQueryNodes?: number;
  };

  export function createComplexityRule(options: QueryComplexityOptions): (context: ValidationContext) => ASTVisitor;

  export function simpleEstimator(options?: { defaultScore?: number }): ComplexityEstimator;

  export function fieldExtensionsEstimator(): ComplexityEstimator;
}
