import { Field, ID, ObjectType } from '@nestjs/graphql';
import { GraphQLScalarType, Kind, ValueNode } from 'graphql';

function parseLiteral(ast: ValueNode): unknown {
  switch (ast.kind) {
    case Kind.STRING:
    case Kind.BOOLEAN:
      return ast.value;
    case Kind.INT:
    case Kind.FLOAT:
      return Number(ast.value);
    case Kind.OBJECT: {
      const value: Record<string, unknown> = {};
      for (const field of ast.fields) {
        value[field.name.value] = parseLiteral(field.value);
      }
      return value;
    }
    case Kind.LIST:
      return ast.values.map((n) => parseLiteral(n));
    case Kind.NULL:
      return null;
    default:
      return null;
  }
}

export const GraphQLJSON = new GraphQLScalarType({
  name: 'JSON',
  description: 'Arbitrary JSON value',
  parseValue(value) {
    return value;
  },
  serialize(value) {
    return value;
  },
  parseLiteral,
});

@ObjectType('User')
export class UserType {
  @Field(() => ID)
  id: string;

  @Field(() => String, { nullable: true })
  username: string | null;

  @Field(() => String, { nullable: true })
  profileAvatarUrl: string | null;

  @Field(() => GraphQLJSON, { nullable: true })
  encryptedProfile: unknown | null;

  @Field(() => String, { nullable: true })
  profileKeyHash: string | null;

  @Field(() => Date)
  createdAt: Date;
}
