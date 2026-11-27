const { buildAdminUserSearchQuery, userMatchesAdminSearch } = require('./adminUserSearch');

let failed = 0;
function assert(cond, msg) {
    if (!cond) {
        failed += 1;
        console.error('FAIL:', msg);
    }
}

const users = [
    { phone: '0911223344', name: 'Abebe', firstName: 'Abebe', telegramUsername: 'abe_0' },
    { phone: '0911556677', name: 'Marta', firstName: 'Marta', telegramUsername: 'QueenM' },
    { phone: '0911888999', name: '0mar', firstName: 'Omar', telegramUsername: 'omarx' },
    { phone: '0911000111', name: 'Sara', firstName: 'Sara', telegramUsername: 's0ra' },
    { phone: '0911777000', name: 'Kidus', firstName: 'Kidus', telegramUsername: 'a.b' }
];

function namesFor(search) {
    return users.filter((u) => userMatchesAdminSearch(search, u)).map((u) => u.name);
}

const zeroHits = namesFor('0');
assert(zeroHits.indexOf('Abebe') !== -1, 'single character 0 matches username abe_0');
assert(zeroHits.indexOf('0mar') !== -1, 'single character 0 matches name 0mar');
assert(zeroHits.indexOf('Sara') !== -1, 'single character 0 matches username s0ra');

assert(namesFor('marta').indexOf('Marta') !== -1, 'lowercase search matches name Marta');
assert(namesFor('ABE').indexOf('Abebe') !== -1, 'uppercase partial matches name Abebe');
assert(namesFor('queen').indexOf('Marta') !== -1, 'partial username search matches QueenM');
assert(namesFor('@QueenM').indexOf('Marta') !== -1, '@ prefix still matches telegram username');
assert(namesFor('Omar').indexOf('0mar') !== -1, 'first name Omar matches when display name differs');
assert(namesFor('zzz').length === 0, 'unrelated substring matches nobody');

const dotQuery = buildAdminUserSearchQuery('a.b');
assert(dotQuery.$or[1].name.$regex === 'a\\.b', 'search dot is a literal character');
assert(namesFor('a.b').indexOf('Kidus') !== -1, 'literal dot username matches');
assert(namesFor('axb').indexOf('Kidus') === -1, 'dot is not a wildcard');
assert(JSON.stringify(buildAdminUserSearchQuery('   ')) === '{}', 'blank search does not filter');
assert(JSON.stringify(buildAdminUserSearchQuery('')) === '{}', 'empty search does not filter');

const single = buildAdminUserSearchQuery('0');
assert(single.$or && single.$or.length === 4, 'single character search queries name, first name, username, and phone');
assert(single.$or[1].name.$options === 'i', 'name match is case-insensitive');
assert(single.$or[3].telegramUsername.$regex === '0', 'username match keeps the single character');

if (failed) {
    console.error(failed + ' assertion(s) failed');
    process.exit(1);
}
console.log('admin user search checks passed');
