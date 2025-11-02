;; OracleFeed.clar

(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-KWH u101)
(define-constant ERR-INVALID-PRICE u102)
(define-constant ERR-FARM-NOT-REGISTERED u103)
(define-constant ERR-INVALID-TIMESTAMP u104)
(define-constant ERR-YIELD-DISTRIBUTOR-NOT-SET u105)

(define-data-var contract-owner principal tx-sender)
(define-data-var yield-distributor principal (as-contract tx-sender))
(define-data-var last-oracle-update uint u0)

(define-map authorized-oracles principal bool)
(define-map farm-production
  { farm-id: uint, block-height: uint }
  {
    kwh-produced: uint,
    price-per-kwh: uint,
    timestamp: uint
  }
)

(define-read-only (is-oracle-authorized (oracle principal))
  (default-to false (map-get? authorized-oracles oracle))
)

(define-read-only (get-last-production (farm-id uint))
  (map-get? farm-production { farm-id: farm-id, block-height: (var-get last-oracle-update) })
)

(define-read-only (get-yield-distributor)
  (var-get yield-distributor)
)

(define-private (is-owner)
  (is-eq tx-sender (var-get contract-owner))
)

(define-public (set-yield-distributor (distributor principal))
  (begin
    (asserts! (is-owner) (err ERR-NOT-AUTHORIZED))
    (var-set yield-distributor distributor)
    (ok true)
  )
)

(define-public (add-oracle (oracle principal))
  (begin
    (asserts! (is-owner) (err ERR-NOT-AUTHORIZED))
    (map-set authorized-oracles oracle true)
    (ok true)
  )
)

(define-public (remove-oracle (oracle principal))
  (begin
    (asserts! (is-owner) (err ERR-NOT-AUTHORIZED))
    (map-delete authorized-oracles oracle)
    (ok true)
  )
)

(define-public (submit-production-data
  (farm-id uint)
  (kwh-produced uint)
  (price-per-kwh uint)
)
  (let (
        (oracle tx-sender)
        (current-height block-height)
        (distributor (var-get yield-distributor))
      )
    (asserts! (is-oracle-authorized oracle) (err ERR-NOT-AUTHORIZED))
    (asserts! (> kwh-produced u0) (err ERR-INVALID-KWH))
    (asserts! (> price-per-kwh u0) (err ERR-INVALID-PRICE))
    (asserts! (not (is-eq distributor (as-contract tx-sender))) (err ERR-YIELD-DISTRIBUTOR-NOT-SET))

    (map-set farm-production
      { farm-id: farm-id, block-height: current-height }
      {
        kwh-produced: kwh-produced,
        price-per-kwh: price-per-kwh,
        timestamp: current-height
      }
    )

    (var-set last-oracle-update current-height)

    (try! (contract-call? distributor submit-revenue farm-id kwh-produced price-per-kwh))
    (ok true)
  )
)

(define-public (emergency-withdraw (amount uint) (recipient principal))
  (begin
    (asserts! (is-owner) (err ERR-NOT-AUTHORIZED))
    (as-contract (stx-transfer? amount tx-sender recipient))
  )
)