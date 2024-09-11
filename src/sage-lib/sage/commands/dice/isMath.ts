import { getNumberRegex, hasMath, processMath } from "@rsc-utils/dice-utils";
import { unwrap } from "@rsc-utils/string-utils";

/**
 * Checks the value against regex to determine if it is a simple math equation.
 * @param value wrapped math (HAS BRACES)
 * @returns
 */
export function isMath(value: string): boolean {
	const unwrapped = unwrap(value, "[]");
	return hasMath(unwrapped)
		&& getNumberRegex({ anchored:true }).test(processMath(unwrapped).trim());
}