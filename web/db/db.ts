import { createLocalDb } from "./local-d1"
import { createRemoteDb } from "./remote-d1"

function useLocalD1() {
	if (process.env.AUTH_D1_LOCAL === "0") {
		return false
	}
	if (process.env.AUTH_D1_LOCAL === "1") {
		return true
	}
	return process.env.NODE_ENV === "development"
}

const db = useLocalD1() ? createLocalDb() : createRemoteDb()

export default db
